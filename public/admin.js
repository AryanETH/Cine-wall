'use strict';

const $ = (selector) => document.querySelector(selector);
const media = $('#mediaPreview');
const timeline = $('#timeline');
const screenLinks = $('#screenLinks');
const warning = $('#fileWarning');
const requestedMode = new URLSearchParams(location.search).get('mode');
const filePeer = window.CineWallFilePeer ? new window.CineWallFilePeer.FilePeer() : null;
const validModes = ['video', 'audio', 'presentation', 'youtube'];
const modeConfig = {
  video: {
    label: 'Video', icon: '&#xE714;', title: 'Video room',
    source: 'Video source',
    choose: 'Choose your video', button: 'Choose video', accept: '.mp4,.m4v,.webm,.mkv', min: 1, max: 3,
    preview: '10s preview',
  },
  audio: {
    label: 'Audio', icon: '&#xE8D6;', title: 'Audio room',
    source: 'Audio source',
    choose: 'Choose your audio', button: 'Choose audio', accept: '.mp3,.wav,.flac,.m4a,.aac,.ogg,.oga,.webm', min: 1, max: 5,
    preview: 'Audio',
  },
  presentation: {
    label: 'Presentation', icon: '&#xE7F4;', title: 'Presentation room',
    source: 'Document',
    choose: 'Choose your presentation', button: 'Choose document', accept: '.pdf,.ppt,.pptx,.pps,.ppsx,.odp,.doc,.docx,.rtf,.png,.jpg,.jpeg,.webp,.gif', min: 1, max: 3,
    preview: 'Preview',
  },
  youtube: {
    label: 'YouTube', icon: '&#xE768;', title: 'YouTube room',
    source: 'YouTube source',
    choose: 'Paste a YouTube link', button: 'Load YouTube', accept: '', min: 1, max: 3,
    preview: 'Preview',
  },
};

let status = {
  screens: [],
  state: {
    sessionMode: 'video', playing: false, position: 0, anchorTime: Date.now(), mode: 'crop',
    screenCount: 3, audioSettings: {}, asset: null, page: 1, commandId: 0,
  },
};
let connectionInfo = null;
let duration = 0;
let serverOffset = 0;
let scrubbing = false;
let uploadBusy = false;
let removeBusy = false;
let loadedMediaVersion = '';
let presentationKey = '';
let mixerTimer = null;
let loopEnabled = false;
let localPreview = null;
let uploadHideTimer = null;
let cancelBusy = false;
let trailerKey = '';
let previewRecoveryAttempts = 0;
let previewRecoveryVersion = '';
let previewRecoveryInFlight = '';
const volumeTimers = new Map();
let controlsQueue = Promise.resolve();
let controlSequence = 0;
const pendingControls = new Map();
const queuedRevisions = new Map();
let sharingMode = 'instant';
let adminDisplayWindow = null;
try { sharingMode = localStorage.getItem('cinewall-sharing') === 'server' ? 'server' : 'instant'; } catch {}

function sourceLocked() {
  return Boolean(status.state.ownerId && status.state.ownerId !== window.CineWallSession?.deviceId);
}

function playbackReady() {
  return status.state.allReady === true && !sourceLocked() && !uploadBusy && !isPreparing();
}

function renderSharing() {
  const options = $('#sharingOptions');
  if (!options) return;
  renderViewerSource();
  options.hidden = !['video', 'audio'].includes(status.state.sessionMode);
  options.querySelectorAll('[data-sharing]').forEach((button) => {
    button.classList.toggle('active', button.dataset.sharing === sharingMode);
    button.setAttribute('aria-pressed', String(button.dataset.sharing === sharingMode));
    button.disabled = uploadBusy || isPreparing() || sourceLocked();
  });
  $('#sourceRole').textContent = status.state.ownerId && status.state.asset?.source === 'peer' && !sourceLocked() ? (status.state.asset.transport === 'hotspot' ? 'Same Wi-Fi · Keep this tab open' : 'Keep this tab open') : '';
  $('#sourceRole').hidden = !$('#sourceRole').textContent;
  $('#adminAssetFile').disabled = sourceLocked() || uploadBusy || removeBusy || isPreparing();
  $('#removeAsset').disabled = sourceLocked() || uploadBusy || removeBusy || isPreparing();
  $('#loadYoutubeDownload').disabled = sourceLocked() || uploadBusy || isPreparing();
  $('#loadYoutube').disabled = sourceLocked() || uploadBusy || isPreparing();
}

function renderViewerSource() {
  const locked = sourceLocked(), editor = $('#sourceEditor'), viewer = $('#viewerSource');
  if (!editor || !viewer) return;
  editor.hidden = locked;
  editor.disabled = locked;
  viewer.hidden = !locked;
  if (!locked) return;
  $('#videoFormatInfo').open = false;
  const select = $('#viewerScreenSelect'), count = status.state.screenCount;
  const numbers = Array.from({ length: Math.max(0, count - 1) }, (_, index) => index + 2);
  const joined = status.screens || [];
  const own = joined.find((screen) => screen.deviceId === window.CineWallSession?.deviceId && numbers.includes(screen.screen));
  const selected = Number(select.value);
  const available = numbers.find((number) => !joined.some((screen) => screen.screen === number && screen.ready));
  const choices = numbers.map((number) => `<option value="${number}">${status.state.sessionMode === 'audio' ? 'Speaker' : 'Screen'} ${number}</option>`).join('');
  if (select.innerHTML !== choices) select.innerHTML = choices;
  select.value = String(own?.screen || (numbers.includes(selected) ? selected : available || numbers[0] || ''));
  $('#openViewerScreen').disabled = !numbers.length;
  select.hidden = numbers.length < 2;
  viewer.querySelector('label').hidden = select.hidden;
}

function openViewerScreen() {
  if (!sourceLocked()) return;
  const number = Number($('#viewerScreenSelect').value);
  if (!Number.isInteger(number) || number < 2 || number > status.state.screenCount) return;
  const route = `/screen.html?screen=${number}`;
  const opened = window.open(window.CineWallSession?.link(route) || route, `cinewall-display-${number}-${window.CineWallSession?.room || 'lan'}`);
  opened?.focus();
}

function acceptState(next) {
  if (next.serverId === status.state.serverId && next.commandId < status.state.commandId) return;
  updateServerTime(next);
  let merged = { ...next, audioSettings: { ...next.audioSettings } };
  for (const [key, intent] of pendingControls) {
    if (intent.assetVersion !== next.asset?.version || intent.sessionMode !== next.sessionMode) { pendingControls.delete(key); continue; }
    if (key === 'playback') merged = { ...merged, ...intent.patch };
    else if (key === 'loop') merged.loop = intent.patch.loop;
    else if (key.startsWith('audio-')) merged.audioSettings[intent.screen] = { ...merged.audioSettings[intent.screen], ...intent.patch };
  }
  status.state = merged;
}

function isPreparing() {
  return ['uploading', 'checking'].includes(status.state.preparation?.phase);
}

function renderPreparation() {
  const job = status.state.preparation;
  const active = isPreparing();
  $('#cancelPreparation').hidden = !active || sourceLocked();
  $('#cancelPreparation').disabled = cancelBusy;
  $('#adminAssetFile').disabled = uploadBusy || active || removeBusy || sourceLocked();
  $('#playlistFiles').disabled = uploadBusy || active;
  if (!active) {
    if (!uploadBusy) $('#uploadProgressWrap').hidden = true;
    return;
  }
  clearTimeout(uploadHideTimer);
  $('#uploadProgressWrap').hidden = false;
  $('#uploadProgressWrap').classList.toggle('preparing', job.phase === 'checking');
  $('#uploadCopy').textContent = job.phase === 'uploading' ? `Sending ${job.name}` : `Checking ${job.name}`;
  $('#uploadProgressText').textContent = job.phase === 'checking' ? 'Checking…' : `${Math.round(job.progress || 0)}%`;
  $('#uploadProgressBar').style.width = `${job.progress || 0}%`;
  $('#assetTitle').textContent = job.name;
  $('#assetStatus').textContent = formatBytes(job.size);
}

function releaseLocalPreview() {
  if (!localPreview) return;
  URL.revokeObjectURL(localPreview.url);
  localPreview = null;
  loadedMediaVersion = '';
}

function previewLocalFile(file, kind) {
  releaseLocalPreview();
  if (kind !== 'video') return;
  const blob = window.CineWallFilePeer?.mediaBlob(file) || file;
  localPreview = { file, kind, url: URL.createObjectURL(blob), pending: true, assetVersion: '', failed: false };
  previewRecoveryAttempts = 0;
  previewRecoveryVersion = '';
  previewRecoveryInFlight = '';
  loadedMediaVersion = `local:${localPreview.url}`;
  duration = 0;
  media.pause();
  media.muted = true;
  media.preload = 'metadata';
  media.src = localPreview.url;
  media.load();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return '--:--';
  const total = Math.floor(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return 'Unknown size';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / (1024 ** unit)).toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
}

function positionNow() {
  const state = status.state;
  if (!state.playing) return state.position || 0;
  return (state.position || 0) + Math.max(0, Date.now() + serverOffset - state.anchorTime) / 1000;
}

function screenRole(number, count = status.state.screenCount, sessionMode = status.state.sessionMode) {
  if (sessionMode === 'audio') return number === 1 ? 'Admin speaker' : `Speaker ${number}`;
  if (sessionMode === 'presentation' && count === 1) return 'Admin · Full page';
  if (count === 2) return number === 1 ? 'Left · Admin' : 'Right';
  return ['', 'Left · Admin', 'Centre', 'Right'][number] || `Display ${number}`;
}

function logicalScreens() {
  const count = status.state.screenCount || 1;
  return Array.from({ length: count }, (_, index) => index + 1).map((number) => {
    const matches = status.screens.filter((screen) => screen.screen === number);
    return matches.sort((a, b) => b.lastSeen - a.lastSeen)[0] || { screen: number, ready: false, mediaReady: false };
  });
}

function isFullyReady(screen) {
  return Boolean(screen.ready && (!status.state.asset || screen.mediaReady && screen.assetVersion === status.state.asset.version && !screen.error && !screen.buffering));
}

function audioSetting(number) {
  return status.state.audioSettings?.[String(number)] || { volume: 1, muted: false };
}

function updateServerTime(state) {
  if (Number.isFinite(state.serverTime)) serverOffset = state.serverTime - Date.now();
}

async function command(payload) {
  if (sourceLocked() && !['screen-audio', 'identify'].includes(payload.type)) return null;
  if (payload.type === 'play' && !playbackReady()) return null;
  const sequence = ++controlSequence;
  const state = status.state;
  const now = Date.now() + serverOffset;
  const key = ['play', 'pause', 'seek', 'restart'].includes(payload.type) ? 'playback' : payload.type === 'screen-audio' ? `audio-${payload.screen}` : '';
  const coalesce = payload.type === 'seek' ? 'seek' : payload.type === 'screen-audio' && 'volume' in payload && !('muted' in payload) ? `volume-${payload.screen}` : '';
  if (coalesce) queuedRevisions.set(coalesce, sequence);
  if (['play', 'pause', 'seek', 'restart'].includes(payload.type)) {
    const position = payload.type === 'restart' ? 0 : Number.isFinite(payload.position) ? payload.position : positionNow();
    const patch = { position, anchorTime: now, notBefore: 0, playing: payload.type === 'play' ? true : payload.type === 'pause' || payload.type === 'restart' ? false : state.playing };
    pendingControls.set(key, { sequence, patch, assetVersion: state.asset?.version, sessionMode: state.sessionMode });
    status.state = { ...state, ...patch };
    renderPlayer();
  } else if (payload.type === 'screen-audio') {
    const patch = { ...audioSetting(payload.screen), ...('volume' in payload ? { volume: payload.volume } : {}), ...('muted' in payload ? { muted: payload.muted } : {}) };
    pendingControls.set(key, { sequence, patch, screen: payload.screen, assetVersion: state.asset?.version, sessionMode: state.sessionMode });
    status.state.audioSettings = { ...state.audioSettings, [payload.screen]: patch };
    renderMixer();
  } else if (payload.type === 'loop') {
    pendingControls.set('loop', { sequence, patch: { loop: Boolean(payload.loop) }, assetVersion: state.asset?.version, sessionMode: state.sessionMode });
    status.state = { ...state, loop: Boolean(payload.loop) }; renderPlayer();
  } else if (['mute-all', 'youtube-audio-mode', 'audio-output'].includes(payload.type)) {
    status.state.audioSettings = { ...state.audioSettings };
    for (let screen = 1; screen <= state.screenCount; screen++) {
      const output = payload.type === 'audio-output' ? payload.output : payload.youtubeAudioMode;
      const patch = { ...audioSetting(screen), muted: payload.type === 'mute-all' ? Boolean(payload.muted) : output !== 'all' && screen !== 1 };
      pendingControls.set(`audio-${screen}`, { sequence, patch, screen, assetVersion: state.asset?.version, sessionMode: state.sessionMode });
      status.state.audioSettings[screen] = patch;
    }
    renderMixer();
  }
  const send = async () => {
  if (coalesce && queuedRevisions.get(coalesce) !== sequence) return null;
  warning.classList.remove('show');
  try {
    const response = await fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The command could not be sent');
    for (const [intentKey, intent] of pendingControls) if (intent.sequence === sequence) pendingControls.delete(intentKey);
    acceptState(result.command);
    render();
    return result.command;
  } catch (error) {
    for (const [intentKey, intent] of pendingControls) if (intent.sequence === sequence) pendingControls.delete(intentKey);
    await refresh();
    warning.textContent = error.message;
    warning.classList.add('show');
    return null;
  }
  };
  const result = controlsQueue.then(send, send);
  controlsQueue = result.catch(() => {});
  return result;
}

function renderModeShell() {
  const state = status.state;
  const config = modeConfig[state.sessionMode] || modeConfig.video;
  document.body.dataset.sessionMode = state.sessionMode;
  $('#modeSwitchIcon').innerHTML = config.icon;
  $('#modeSwitchLabel').textContent = config.label;
  $('#pageTitle').textContent = config.title;
  $('#sourceHeading').textContent = config.source;
  $('#sourceHeadingIcon').innerHTML = config.icon;
  $('#sourceIcon').innerHTML = config.icon;
  $('#previewBadgeText').textContent = config.preview;
  $('#adminAssetFile').accept = config.accept;
  $('#adminAssetFile').multiple = state.sessionMode === 'audio';
  $('#adminFileLabel').textContent = state.sessionMode === 'audio' ? 'Add songs' : state.asset ? `Change ${config.label.toLowerCase()}` : config.button;
  $('#framingPanel').hidden = state.sessionMode === 'audio';
  $('#presenterTips').hidden = state.sessionMode !== 'presentation';
  $('#mediaControls').hidden = state.sessionMode === 'presentation';
  $('#presentationControls').hidden = state.sessionMode !== 'presentation';
  $('#previewGesture').hidden = state.sessionMode !== 'video' || !state.asset;
  const localMediaMode = ['video', 'audio'].includes(state.sessionMode);
  $('#sharingPanel').hidden = !localMediaMode;
  $('#settings').hidden = sourceLocked();
  $('#muteAll').disabled = sourceLocked();
  if (!localMediaMode) $('#youtubeDownloadPanel').hidden = true;
  const downloadingYouTube = localMediaMode && !$('#youtubeDownloadPanel').hidden;
  // Keep the unfinished playlist action out of the simplified dashboard.
  $('#playlistButton').hidden = true;
  $('#loopButton').hidden = state.sessionMode === 'presentation';
  $('#dropZone').hidden = !localMediaMode || downloadingYouTube;
  $('#videoFormatInfo').hidden = state.sessionMode !== 'video' || downloadingYouTube;
  if ($('#videoFormatInfo').hidden) $('#videoFormatInfo').open = false;

  // Update drop zone icon based on mode
  if (!$('#dropZone').hidden) {
    const dropIcon = $('#dropZone .drop-zone-icon');
    const dropText = $('#dropZone strong');
    dropIcon.innerHTML = config.icon;
    dropText.textContent = state.sessionMode === 'audio' ? 'Drop an audio file' : 'Drop a video file';
  }

  // Show/hide source inputs based on session mode
  const isYouTube = state.sessionMode === 'youtube';
  $('#fileSourceButton').hidden = isYouTube || downloadingYouTube;
  $('#localVideoSource').textContent = 'Local file';
  $('#localVideoSource').classList.toggle('active', !downloadingYouTube);
  $('#localVideoSource').setAttribute('aria-pressed', String(!downloadingYouTube));
  $('#downloadYoutubeToggle').classList.toggle('active', downloadingYouTube);
  $('#downloadYoutubeToggle').setAttribute('aria-pressed', String(downloadingYouTube));
  $('#downloadYoutubeToggle').setAttribute('aria-expanded', String(downloadingYouTube));
  $('#youtubeSourceForm').hidden = !isYouTube;
  $('#videoSourceSelector').hidden = !localMediaMode;
  window.CineWallDownloadPanel?.syncMode(state.sessionMode);
  $('#removeAsset').hidden = !state.asset;
  $('#removeAsset').disabled = uploadBusy || isPreparing() || removeBusy;
  $('#removeAsset').title = `Remove ${config.label.toLowerCase()}`;
  $('#removeAsset').setAttribute('aria-label', `Remove loaded ${config.label.toLowerCase()}`);

  $('#framingHeading').textContent = state.sessionMode === 'presentation' ? 'Page fit' : 'Picture fit';
  const framingLabels = state.sessionMode === 'presentation'
    ? { fit: 'Fit page', crop: 'Fill width', stretch: 'Stretch' }
    : { fit: 'Fit', crop: 'Crop', stretch: 'Stretch' };
  $('#modeControls').querySelectorAll('[data-mode]').forEach((button) => {
    button.textContent = framingLabels[button.dataset.mode];
    button.hidden = ['presentation', 'youtube'].includes(state.sessionMode) && button.dataset.mode === 'stretch';
  });
  $('#modeControls').querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('active', button.dataset.mode === state.mode));

  if (state.sessionMode === 'presentation') {
    $('#shortcutHint').innerHTML = '<span><kbd>←</kbd><kbd>→</kbd> Change page</span>';
  } else if (state.sessionMode === 'audio') {
    $('#shortcutHint').innerHTML = '<span><kbd>Space</kbd> Play / pause</span><span><kbd>←</kbd><kbd>→</kbd> Skip 10s</span>';
  } else {
    $('#shortcutHint').innerHTML = '<span><kbd>Space</kbd> Play / pause</span><span><kbd>←</kbd><kbd>→</kbd> Seek 10s</span><span>Double-click left/right to seek</span>';
  }
}

function instantFeedback(screen) {
  const state = status.state, asset = state.asset;
  const visible = ['video', 'audio'].includes(state.sessionMode) && (asset ? asset.source === 'peer' : sharingMode === 'instant');
  if (!visible) return { hidden: true };
  const result = (kind, text) => ({ hidden: false, kind, text });
  if (!screen.ready) return result('waiting', 'Open screen to connect');
  if (!asset) return result('waiting', 'Choose a file to check');
  if (screen.assetVersion !== asset.version) return result('searching', 'Searching for hotspot…');
  if (screen.instantConnection === 'local') return result('local', 'On this laptop');
  if (screen.instantConnection === 'disconnected') return result('disconnected', 'Connection lost · retrying');
  if (screen.instantConnection === 'connected') return result('connected', asset.transport === 'hotspot' ? 'Hotspot / Wi-Fi connected' : 'Local network connected');
  return result('searching', 'Searching for hotspot…');
}

function renderScreens() {
  const state = status.state;
  const screens = logicalScreens();
  screens.forEach((screen) => {
    const card = screenLinks.querySelector(`[data-speaker="${screen.screen}"]`);
    if (!card) return;
    const fullyReady = isFullyReady(screen);
    const progress = isPreparing() ? Math.round(state.preparation.progress || 0) : fullyReady ? 100 : Math.round(screen.loadProgress || 0);
    const stateLabel = screen.error ? 'Needs attention' : !screen.ready ? 'Waiting' : isPreparing() ? `Sending ${progress}%` : !state.asset ? 'Connected' : screen.buffering ? 'Buffering' : !fullyReady ? `Loading ${progress}%` : screen.autoplayMuted ? 'Tap for sound' : 'Ready';
    const outdated = screen.build && screen.build !== '2026.10.05-feedback-28';
    const badge = card.querySelector('[data-screen-state]');
    badge.querySelector('span:last-child').textContent = stateLabel;
    card.classList.toggle('ready', fullyReady);
    card.classList.toggle('needs-attention', Boolean(screen.error));
    const notice = card.querySelector('.screen-notice');
    notice.textContent = screen.error || (outdated ? 'Reopen this screen to update.' : '');
    notice.hidden = !notice.textContent;
    const loading = card.querySelector('progress');
    loading.value = progress;
    loading.hidden = !isPreparing() && (!state.asset || fullyReady || !screen.ready);
    const connection = card.querySelector('[data-instant-state]');
    if (connection) {
      const feedback = instantFeedback(screen);
      connection.hidden = feedback.hidden;
      if (!feedback.hidden) {
        connection.dataset.connection = feedback.kind;
        connection.querySelector('[data-instant-label]').textContent = feedback.text;
        connection.title = 'Instant sharing connection. All laptops need the same hotspot or Wi-Fi and room link.';
      }
    }
  });
}

function primaryAddress() {
  return connectionInfo?.addresses?.[0] || location.hostname;
}

function renderLinks() {
  if (!connectionInfo) return;
  const state = status.state;
  const config = modeConfig[state.sessionMode];
  const hosted = window.CineWallSession?.hosted || connectionInfo.hosted;
  const baseRemote = hosted ? location.origin : `http://${primaryAddress()}:${connectionInfo.port}`;
  const noun = state.sessionMode === 'audio' ? 'speaker' : 'screen';
  $('#linksHeading').textContent = state.sessionMode === 'audio' ? 'Speakers' : 'Screens';
  $('#addDisplayLabel').textContent = `Add ${noun}`;
  $('#addDisplay').disabled = state.screenCount >= config.max;
  $('#addDisplay').title = state.screenCount >= config.max ? `Maximum ${config.max} ${noun}s reached` : `Add another ${noun}`;
  $('#addDisplay').hidden = state.screenCount >= config.max;
  const key = `${state.sessionMode}:${state.screenCount}:${location.origin}:${baseRemote}:${window.CineWallSession?.room || ''}`;
  if (screenLinks.cinewallLinksKey === key) return;
  screenLinks.cinewallLinksKey = key;
  screenLinks.style.gridTemplateColumns = `repeat(${Math.min(state.screenCount, 3)}, 1fr)`;
  screenLinks.innerHTML = Array.from({ length: state.screenCount }, (_, index) => index + 1).map((number) => {
    const origin = number === 1 ? location.origin : baseRemote;
    const url = window.CineWallSession?.link(`/screen.html?screen=${number}`, origin) || `${origin}/screen.html?screen=${number}`;
    const role = screenRole(number, state.screenCount, state.sessionMode);
    const device = number === 1 ? 'This laptop' : role;
    const removable = number === state.screenCount && state.screenCount > config.min;
    return `<article class="screen-link-card" data-speaker="${number}">
      <div class="screen-identity"><span class="screen-role-icon fi">&#xE7F4;</span><span class="display-number">${number}</span><div><strong>${noun === 'speaker' ? 'Speaker' : 'Screen'} ${number}</strong><small>${escapeHtml(device)}</small></div></div>
      <span class="screen-status" data-screen-state><span class="status-dot"></span><span>Waiting</span></span>
      <span class="instant-status" data-instant-state role="status" hidden><span class="status-dot" aria-hidden="true"></span><span data-instant-label></span></span>
      <div class="link-actions"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" aria-label="Open ${noun} ${number}"><span class="fi">&#xE8A7;</span>Open</a><button data-copy-link="${escapeHtml(url)}" title="Copy link" aria-label="Copy ${noun} ${number} link"><span class="fi">&#xE8C8;</span></button></div>
      <div class="screen-volume"${state.sessionMode === 'presentation' ? ' hidden' : ''}><button data-mute-screen="${number}" class="mini-icon-button" aria-label="Mute ${noun} ${number}"><span class="fi">&#xE767;</span></button><input data-volume-screen="${number}" type="range" min="0" max="1" step="0.01" value="1" aria-label="${noun} ${number} volume"><output class="visually-hidden">100%</output></div>
      ${removable ? `<button class="remove-screen-button" data-remove-display="${number}" title="Remove ${noun}" aria-label="Remove ${noun} ${number}"><span class="fi">&#xE711;</span></button>` : ''}
      <p class="screen-notice" hidden></p><progress class="screen-load-progress" max="100" value="0" aria-label="${noun} ${number} loading" hidden></progress>
    </article>`;
  }).join('');
}

function renderMixer() {
  if (status.state.sessionMode === 'presentation') return;
  screenLinks.querySelectorAll('[data-speaker]').forEach((card) => {
    const setting = audioSetting(Number(card.dataset.speaker)), slider = card.querySelector('input'), button = card.querySelector('[data-mute-screen]');
    if (document.activeElement !== slider && !volumeTimers.has(Number(card.dataset.speaker))) slider.value = setting.volume;
    card.querySelector('output').textContent = `${Math.round(Number(slider.value) * 100)}%`;
    card.classList.toggle('muted', setting.muted);
    button.innerHTML = `<span class="fi">${setting.muted ? '&#xE74F;' : '&#xE767;'}</span>`;
    button.setAttribute('aria-label', `${setting.muted ? 'Unmute' : 'Mute'} ${screenRole(Number(card.dataset.speaker))}`);
  });
  const activeSettings = Array.from({ length: status.state.screenCount }, (_, index) => audioSetting(index + 1));
  const allMuted = activeSettings.every((setting) => setting.muted);
  $('#muteAll').innerHTML = `<span class="fi">${allMuted ? '&#xE767;' : '&#xE74F;'}</span>${allMuted ? 'Unmute all' : 'Mute all'}`;
  $('#muteAll').dataset.muted = String(allMuted);

  const admin = audioSetting(1);
  $('#adminMute').innerHTML = `<span class="fi">${admin.muted ? '&#xE74F;' : '&#xE767;'}</span>`;
  $('#adminMute').classList.toggle('active', admin.muted);
  if (document.activeElement !== $('#adminVolume') && !volumeTimers.has(1)) $('#adminVolume').value = admin.volume;
  $('#adminVolumeValue').textContent = `${Math.round(Number($('#adminVolume').value) * 100)}%`;
}

function presentationUrl(asset, page) {
  const path = `/api/media/stream?v=${encodeURIComponent(asset.version)}`;
  const base = window.CineWallSession?.link(path) || path;
  if (asset.renderType === 'pdf') return `${base}#page=${page}&view=FitH&toolbar=0&navpanes=0`;
  if (asset.renderType === 'html') return `${base}#page=${page}`;
  return base;
}

function setPreviewKind() {
  const state = status.state;
  const config = modeConfig[state.sessionMode];
  const hasAsset = Boolean(state.asset);
  const isPresentation = state.sessionMode === 'presentation';
  const isAudio = state.sessionMode === 'audio';
  const isYouTube = state.sessionMode === 'youtube';
  if (filePeer?.asset && filePeer.asset.version !== state.asset?.version && !uploadBusy) filePeer.clear();

  if (localPreview?.pending && state.preparation?.phase === 'ready' && state.asset?.name === localPreview.file.name && state.asset.originalSize === localPreview.file.size) {
    localPreview.pending = false;
    localPreview.assetVersion = state.asset.version;
    if (localPreview.failed) releaseLocalPreview();
  }
  if (localPreview && (localPreview.kind !== state.sessionMode || (!localPreview.pending && localPreview.assetVersion !== state.asset?.version))) releaseLocalPreview();
  if (localPreview) {
    media.hidden = false;
    $('#audioPreview').hidden = true;
    $('#presentationFrame').hidden = true;
    $('#presentationImage').hidden = true;
    $('#youtubePreview').hidden = true;
    $('#youtubeThumbnail').hidden = true;
    $('#sourceIcon').hidden = false;
    $('#previewEmpty').hidden = !localPreview.failed;
    if (localPreview.failed) {
      $('#previewEmptyTitle').textContent = 'Video cannot play here';
      $('#previewEmptyCopy').textContent = 'Use MP4 with H.264 video and AAC audio.';
    }
    return;
  }

  media.hidden = isPresentation || isAudio || isYouTube;
  $('#audioPreview').hidden = !isAudio || !hasAsset;
  $('#presentationFrame').hidden = !isPresentation || !hasAsset || state.asset.renderType === 'image';
  $('#presentationImage').hidden = !isPresentation || !hasAsset || state.asset.renderType !== 'image';
  $('#youtubePreview').hidden = !isYouTube || !hasAsset;
  $('#previewEmpty').hidden = hasAsset;
  $('#previewEmptyIcon').innerHTML = config.icon;
  $('#previewEmptyTitle').textContent = `${config.label} preview`;
  $('#previewEmptyCopy').textContent = '';

  if (!hasAsset) {
    duration = 0;
    scrubbing = false;
    timeline.value = 0;
    $('#currentTime').textContent = '0:00';
    loadedMediaVersion = '';
    presentationKey = '';
    media.pause();
    media.removeAttribute('src');
    media.load();
    $('#presentationFrame').removeAttribute('src');
    $('#presentationImage').removeAttribute('src');
    $('#youtubePreviewImage')?.removeAttribute('src');
    $('#youtubePreview').innerHTML = '<img id="youtubePreviewImage" alt="YouTube preview"><div><span class="fi">&#xE768;</span><strong>YouTube wall ready</strong><small>Playback opens on Display 1, not inside this dashboard.</small></div>';
    delete $('#youtubePreview').dataset.videoId;
    $('#youtubeThumbnail').hidden = true;
    $('#sourceIcon').hidden = false;
    return;
  }

  if (isYouTube && state.asset.videoId) {
    const videoId = state.asset.videoId;
    if ($('#youtubePreview').dataset.videoId !== videoId) {
      $('#youtubePreview').dataset.videoId = videoId;
      $('#youtubePreview').innerHTML = `<img id="youtubePreviewImage" src="${escapeHtml(state.asset.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`)}" alt="YouTube video thumbnail"><div><span class="fi">&#xE768;</span><strong>YouTube wall ready</strong><small>Use Play to open Display 1 and start every joined display.</small></div>`;
    }
    if (state.asset.thumbnail) {
      $('#youtubeThumbnail').src = state.asset.thumbnail;
      $('#youtubeThumbnail').hidden = false;
      $('#sourceIcon').hidden = true;
    }
  } else {
    $('#youtubeThumbnail').hidden = true;
    $('#sourceIcon').hidden = false;
  }

  if (!isPresentation && !isYouTube && state.asset.version !== loadedMediaVersion) {
    loadedMediaVersion = state.asset.version;
    if (previewRecoveryVersion !== state.asset.version) { previewRecoveryVersion = state.asset.version; previewRecoveryAttempts = 0; previewRecoveryInFlight = ''; }
    duration = 0;
    if (state.asset.source === 'peer' && filePeer) {
      const version = state.asset.version;
      filePeer.open(state.asset).then((url) => { if (status.state.asset?.version === version) { media.src = url; media.load(); } }).catch((error) => { warning.textContent = error.message; warning.classList.add('show'); });
    } else { media.src = window.CineWallSession?.link(`/api/media/stream?v=${encodeURIComponent(state.asset.version)}`) || `/api/media/stream?v=${encodeURIComponent(state.asset.version)}`; media.load(); }
  }
  if (isPresentation) {
    const key = `${state.asset.version}:${state.page}`;
    if (key !== presentationKey) {
      presentationKey = key;
      if (state.asset.renderType === 'pdf') $('#presentationFrame').src = presentationUrl(state.asset, state.page);
      else $('#presentationImage').src = presentationUrl(state.asset, state.page);
    }
  }
}

function renderPlayer() {
  renderSharing();
  const state = status.state;
  const config = modeConfig[state.sessionMode];
  const hasAsset = Boolean(state.asset);
  const isYouTube = state.sessionMode === 'youtube';
  if (isYouTube) {
    const remoteDurations = status.screens.filter((screen) => screen.screen <= state.screenCount).map((screen) => Number(screen.duration) || 0);
    duration = Math.max(0, ...remoteDurations);
    const titledScreen = status.screens.find((screen) => screen.fileName && !screen.fileName.startsWith('YouTube ·'));
    if (hasAsset && titledScreen?.fileName) state.asset.name = titledScreen.fileName;
  }
  setPreviewKind();
  if (hasAsset && ['video', 'audio'].includes(state.sessionMode) && !Number.isFinite(media.duration)) {
    duration = Math.max(duration || 0, ...status.screens.filter((screen) => screen.mediaReady && screen.screen <= state.screenCount).map((screen) => Number(screen.duration) || 0));
  }
  $('#replayPreview').hidden = state.sessionMode !== 'video' || !(hasAsset || localPreview);
  if (hasAsset && state.asset.source === 'peer' && state.asset.duration && !duration) duration = state.asset.duration;
  $('#assetTitle').textContent = localPreview?.file.name || state.asset?.name || config.choose;
  $('#assetStatus').textContent = state.asset ? (isYouTube ? 'Ready' : formatBytes(state.asset.size)) : '';
  if (localPreview?.pending) $('#assetStatus').textContent = formatBytes(localPreview.file.size);

  if (state.sessionMode === 'presentation') {
    $('#playerState').textContent = hasAsset ? `PAGE ${state.page}` : 'IDLE';
    $('#playerState').hidden = !hasAsset;
    $('#pageNumber').value = state.page || 1;
    $('#pageNumber').max = state.asset?.pageCount || 999;
    $('#pageTotal').textContent = `/ ${state.asset?.pageCount || '--'}`;
    $('#previousPage').disabled = !hasAsset || state.page <= 1;
    $('#nextPage').disabled = !hasAsset || (state.asset.pageCount && state.page >= state.asset.pageCount);
  } else {
    $('#playerState').textContent = state.playing ? 'PLAYING' : hasAsset ? 'PAUSED' : 'IDLE';
    $('#play').hidden = Boolean(state.playing);
    $('#pause').hidden = !state.playing;
    ['#restart', '#back', '#play', '#pause', '#forward', '#loopButton'].forEach((selector) => { $(selector).disabled = !hasAsset || uploadBusy || isPreparing(); });
    $('#play').disabled = !hasAsset || !playbackReady();
    $('#play').title = !hasAsset ? 'Choose a file' : sourceLocked() ? 'Controlled by the admin' : !playbackReady() ? 'Waiting for every display' : 'Play';
    if (hasAsset && !state.playing && !playbackReady()) $('#playerState').textContent = sourceLocked() ? 'VIEWER' : 'WAITING FOR DISPLAYS';
    $('#playerState').hidden = !hasAsset || state.playing || playbackReady();
    if (!$('#playerState').hidden) $('#playerState').textContent = sourceLocked() ? 'Controlled by another laptop' : 'Waiting for screens';
    loopEnabled = Boolean(state.loop);
    $('#loopButton').classList.toggle('active', loopEnabled);
    timeline.disabled = !hasAsset || uploadBusy || isPreparing();
    timeline.max = duration || 100;
    $('#duration').textContent = duration ? formatTime(duration) : isYouTube && hasAsset ? 'Loading...' : '--:--';
    syncPreview();
  }
  applyPreviewVolume();
  renderSourcePoster();
  if (!scrubbing && state.sessionMode !== 'presentation') {
    timeline.value = Math.min(duration || Infinity, positionNow());
    $('#currentTime').textContent = formatTime(Number(timeline.value));
  }
}

function renderSourcePoster() {
  const poster = $('#sourcePoster');
  const visible = status.state.sessionMode === 'video' && Boolean(loadedMediaVersion) && poster.dataset.version === loadedMediaVersion;
  poster.hidden = !visible;
  if (status.state.sessionMode === 'video') $('#sourceIcon').hidden = visible;
}

function captureSourcePoster() {
  if (status.state.sessionMode !== 'video' || !media.videoWidth || !media.videoHeight || !loadedMediaVersion) return;
  const poster = $('#sourcePoster');
  if (poster.dataset.version === loadedMediaVersion) return;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 90;
    const context = canvas.getContext('2d');
    context.drawImage(media, 0, 0, canvas.width, canvas.height);
    // loadeddata can arrive before the first painted frame. Keep the icon until
    // a visible frame exists, and retry as the muted preview advances.
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let visiblePixels = false;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 24) { visiblePixels = true; break; }
    }
    if (!visiblePixels) return;
    poster.src = canvas.toDataURL('image/jpeg', 0.8);
    poster.dataset.version = loadedMediaVersion;
    renderSourcePoster();
  } catch { /* A thumbnail is optional; playback never depends on it. */ }
}

function applyPreviewVolume() {
  media.muted = true;
}

function updateAudioWaves() {
  const state = status.state;
  const playing = state.sessionMode === 'audio' && Boolean(state.asset && state.playing) && Number(state.notBefore || 0) <= Date.now() + serverOffset &&
    logicalScreens().some(screen => isFullyReady(screen) && screen.paused === false && !screen.buffering);
  $('#audioPreview').classList.toggle('playing', playing);
}

function syncPreview() {
  updateAudioWaves();
  const state = status.state;
  if (state.sessionMode === 'video') return;
  // A selected local file is a silent still preview, never a second playback instance.
  if (localPreview?.pending) { media.pause(); return; }
  if (state.sessionMode === 'youtube' && state.asset) {
    const target = Math.min(duration || Infinity, positionNow());
    if (!scrubbing) {
      timeline.value = Number.isFinite(target) ? target : 0;
      $('#currentTime').textContent = formatTime(target);
    }
    return;
  }
  if (!state.asset || !['video', 'audio'].includes(state.sessionMode) || !Number.isFinite(media.duration)) return;
  const target = Math.min(positionNow(), Math.max(0, media.duration - 0.04));
  if (!scrubbing) {
    timeline.value = target;
    $('#currentTime').textContent = formatTime(target);
  }
  if (Math.abs(media.currentTime - target) > 0.28) media.currentTime = target;
  media.pause();
}

function render() {
  renderModeShell();
  renderLinks();
  renderScreens();
  renderMixer();
  renderPlayer();
  renderPreparation();
  audioQueue.render();
  audioQueue.queue.observe(status.state, status.screens);
}

function showGestureFeedback(direction) {
  const feedback = $('#gestureFeedback');
  feedback.textContent = direction < 0 ? '−10 seconds' : '+10 seconds';
  feedback.className = `gesture-feedback show ${direction < 0 ? 'left' : 'right'}`;
  setTimeout(() => { feedback.className = 'gesture-feedback'; }, 650);
}

function seekRelative(seconds) {
  if (!status.state.asset || status.state.sessionMode === 'presentation') return;
  const next = Math.max(0, Math.min(duration || Infinity, positionNow() + seconds));
  showGestureFeedback(seconds);
  command({ type: 'seek', position: next });
}

function openDisplayOne() {
  if (!adminDisplayWindow || adminDisplayWindow.closed) {
    adminDisplayWindow = window.open(window.CineWallSession?.link('/screen.html?screen=1') || '/screen.html?screen=1', `cinewall-display-1-${window.CineWallSession?.room || 'lan'}`);
  }
  adminDisplayWindow?.focus();
}

function playOnAdminDisplay() {
  if (!playbackReady()) return;
  // An already-ready display may have been opened using its copied link.
  // Do not navigate/reload it just as the synchronized play command arrives.
  if (adminDisplayWindow && !adminDisplayWindow.closed) adminDisplayWindow.focus();
  command({ type: 'play', position: positionNow() });
}

$('#sharingOptions')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-sharing]');
  if (!button || uploadBusy || isPreparing() || sourceLocked()) return;
  sharingMode = button.dataset.sharing === 'server' ? 'server' : 'instant';
  try { localStorage.setItem('cinewall-sharing', sharingMode); } catch {}
  renderSharing();
});

$('#play').addEventListener('click', playOnAdminDisplay);
$('#openViewerScreen').addEventListener('click', openViewerScreen);
$('#pause').addEventListener('click', () => command({ type: 'pause' }));
$('#restart').addEventListener('click', () => command({ type: 'restart' }));
$('#back').addEventListener('click', () => seekRelative(-10));
$('#forward').addEventListener('click', () => seekRelative(10));
$('#loopButton').addEventListener('click', () => {
  command({ type: 'loop', loop: !status.state.loop });
});
$('#previousPage').addEventListener('click', () => command({ type: 'previous-page' }));
$('#nextPage').addEventListener('click', () => command({ type: 'next-page' }));
$('#pageNumber').addEventListener('change', () => command({ type: 'page', page: Number($('#pageNumber').value) }));
$('#identify').addEventListener('click', () => command({ type: 'identify' }));
$('#openAdminScreen').addEventListener('click', openDisplayOne);
$('#presentFullscreen').addEventListener('click', openDisplayOne);
$('#previewGesture').addEventListener('dblclick', (event) => {
  const bounds = event.currentTarget.getBoundingClientRect();
  seekRelative(event.clientX - bounds.left < bounds.width / 2 ? -10 : 10);
});

$('#addDisplay').addEventListener('click', () => {
  const config = modeConfig[status.state.sessionMode];
  if (status.state.screenCount < config.max) command({ type: 'layout', screenCount: status.state.screenCount + 1 });
});
$('#modeControls').addEventListener('click', (event) => {
  const button = event.target.closest('[data-mode]');
  if (button) command({ type: 'mode', mode: button.dataset.mode });
});

timeline.addEventListener('pointerdown', () => { scrubbing = true; });
timeline.addEventListener('input', () => { scrubbing = true; $('#currentTime').textContent = formatTime(Number(timeline.value)); });
timeline.addEventListener('change', () => {
  command({ type: 'seek', position: Number(timeline.value) });
  scrubbing = false;
});
timeline.addEventListener('pointercancel', () => { scrubbing = false; });

function queueVolume(screen, volume) {
  clearTimeout(volumeTimers.get(screen));
  status.state.audioSettings = { ...status.state.audioSettings, [screen]: { ...audioSetting(screen), volume } };
  volumeTimers.set(screen, setTimeout(() => { volumeTimers.delete(screen); command({ type: 'screen-audio', screen, volume }); }, 35));
}

screenLinks.addEventListener('input', (event) => {
  const slider = event.target.closest('[data-volume-screen]');
  if (!slider) return;
  slider.parentElement.querySelector('output').textContent = `${Math.round(Number(slider.value) * 100)}%`;
  if (Number(slider.dataset.volumeScreen) === 1) {
    media.volume = Number(slider.value);
    $('#adminVolume').value = slider.value;
    $('#adminVolumeValue').textContent = `${Math.round(Number(slider.value) * 100)}%`;
  }
  queueVolume(Number(slider.dataset.volumeScreen), Number(slider.value));
});
screenLinks.addEventListener('click', (event) => {
  const button = event.target.closest('[data-mute-screen]');
  if (!button) return;
  const screen = Number(button.dataset.muteScreen);
  command({ type: 'screen-audio', screen, muted: !audioSetting(screen).muted });
});
$('#muteAll').addEventListener('click', () => command({ type: 'mute-all', muted: $('#muteAll').dataset.muted !== 'true' }));
$('#adminMute').addEventListener('click', () => command({ type: 'screen-audio', screen: 1, muted: !audioSetting(1).muted }));
$('#adminVolume').addEventListener('input', () => {
  const value = Number($('#adminVolume').value);
  $('#adminVolumeValue').textContent = `${Math.round(value * 100)}%`;
  media.volume = value;
  queueVolume(1, value);
});

async function copyText(value, button) {
  try {
    await navigator.clipboard.writeText(value);
    button.innerHTML = '<span class="fi">&#xE73E;</span>';
  } catch {
    const helper = document.createElement('textarea');
    helper.value = value;
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    document.execCommand('copy');
    helper.remove();
  }
  setTimeout(() => { button.innerHTML = '<span class="fi">&#xE8C8;</span>'; }, 1200);
}

screenLinks.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-remove-display]');
  if (removeButton) {
    const config = modeConfig[status.state.sessionMode];
    if (status.state.screenCount > config.min) command({ type: 'layout', screenCount: status.state.screenCount - 1 });
    return;
  }
  const button = event.target.closest('[data-copy-link]');
  if (button) copyText(button.dataset.copyLink, button);
});

$('#adminAssetFile').addEventListener('change', () => {
  const files = Array.from($('#adminAssetFile').files);
  $('#adminAssetFile').value = '';
  if (!files.length) return;
  if (status.state.sessionMode === 'audio') void audioQueue.queue.add(files);
  else void uploadFile(files[0]);
});

$('#playlistFiles').addEventListener('change', () => {
  const files = Array.from($('#playlistFiles').files);
  $('#playlistFiles').value = '';
  if (files.length) void audioQueue.queue.add(files);
});

const audioQueue = window.CineWallAudioQueue.attach({
  state: () => status.state,
  locked: sourceLocked,
  blocked: () => sourceLocked() || uploadBusy || removeBusy || isPreparing() || status.state.sessionMode !== 'audio',
  validate: (file) => window.CineWallVideoFile.validateAudio(file),
  load: (file) => uploadFile(file, { validated: true }),
  removeCurrent: async () => {
    if (!status.state.asset) return true;
    const removed = await command({ type: 'clear-asset', assetVersion: status.state.asset.version });
    if (removed) { filePeer?.clear(); releaseLocalPreview(); return true; }
    return false;
  },
  play: async (version) => status.state.asset?.version === version ? command({ type: 'play', position: 0 }) : null,
  error: (message) => { warning.textContent = message; warning.classList.add('show'); },
});

$('#removeAsset').addEventListener('click', async () => {
  if (!status.state.asset || uploadBusy || isPreparing() || removeBusy) return;
  removeBusy = true;
  renderModeShell();
  try {
    const result = await command({ type: 'clear-asset', assetVersion: status.state.asset.version });
    if (result) {
      audioQueue.queue.clear();
      filePeer?.clear();
      $('#adminAssetFile').value = '';
      $('#youtubeUrl').value = '';
      $('#uploadProgressWrap').hidden = true;
    }
  } finally {
    removeBusy = false;
    render();
  }
});

$('#cancelPreparation').addEventListener('click', async () => {
  if (!isPreparing() || cancelBusy) return;
  cancelBusy = true;
  renderPreparation();
  try {
    const response = await fetch('/api/media/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: status.state.preparation.version }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Preparation could not be cancelled');
    status.state = result.state;
    await refresh();
  } catch (error) { warning.textContent = error.message; warning.classList.add('show'); }
  finally { cancelBusy = false; render(); }
});

const VIDEO_FORMAT_HELP = window.CineWallVideoFile?.help || 'This video is not supported by your browser. Try an MP4 with H.264 video and AAC audio.';

async function shareLocalFile(file) {
  uploadBusy = true;
  warning.classList.remove('show');
  previewLocalFile(file, status.state.sessionMode);
  render();
  try {
    const localOnly = Boolean(window.CineWallSession?.hosted);
    const state = await filePeer.publish(file, Number.isFinite(media.duration) ? media.duration : 0, { relay: !localOnly, localOnly });
    status.state = state;
    if (localPreview) {
      localPreview.pending = false;
      localPreview.assetVersion = state.asset.version;
      // A preview that failed during the metadata handshake must enter the
      // same native retries as Display 1, not remain behind an old error card.
      if (localPreview.failed) releaseLocalPreview();
    }
    updateServerTime(state);
    $('#adminAssetFile').value = '';
    return state;
  } catch (error) {
    releaseLocalPreview(); warning.textContent = error.message; warning.classList.add('show');
    return null;
  } finally { uploadBusy = false; render(); }
}

// Shared upload function
async function uploadFile(file, { validated = false } = {}) {
  if (!file || uploadBusy || removeBusy) return;
  if (sourceLocked()) { warning.textContent = 'Wait until the admin removes its file.'; warning.classList.add('show'); return; }
  if (isPreparing()) { renderPreparation(); return; }
  const kind = status.state.sessionMode;
  // Open during the file-picker gesture, not after an asynchronous upload.
  if (window.CineWallSession?.deviceId && !status.screens.some((screen) => screen.screen === 1 && screen.ready)) openDisplayOne();
  if (window.CineWallSession?.deviceId) {
    uploadBusy = true;
    try {
      const response = await fetch('/api/source/claim', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      acceptState(result.state);
    } catch (error) { warning.textContent = error.message; warning.classList.add('show'); uploadBusy = false; render(); return; }
    uploadBusy = false;
  }
  if (['video', 'audio'].includes(kind)) {
    uploadBusy = true;
    $('#adminAssetFile').disabled = true;
    warning.classList.remove('show');
    try {
      if (!window.CineWallVideoFile) throw new Error('Reload CineWall and choose the file again.');
      if (!validated) await window.CineWallVideoFile[kind === 'video' ? 'validate' : 'validateAudio'](file);
    }
    catch (error) {
      warning.textContent = error.message || VIDEO_FORMAT_HELP;
      warning.classList.add('show');
      $('#adminAssetFile').value = '';
      if (window.CineWallSession?.deviceId) fetch('/api/source/release', { method: 'POST' }).then(() => refresh()).catch(() => {});
      return;
    } finally { uploadBusy = false; $('#adminAssetFile').disabled = false; }
    if (status.state.sessionMode !== kind) return;
  }
  const needsNetworkCopy = sharingMode === 'server';
  if (['video', 'audio'].includes(kind) && filePeer && !needsNetworkCopy) return shareLocalFile(file);
  uploadBusy = true;
  clearTimeout(uploadHideTimer);
  previewLocalFile(file, kind);
  render();
  $('#uploadProgressWrap').hidden = false;
  $('#uploadProgressWrap').classList.remove('preparing');
  $('#uploadProgressBar').style.width = '0%';
  $('#uploadProgressText').textContent = '0%';
  $('#uploadCopy').textContent = kind === 'presentation' ? 'Opening document' : 'Sending file to screens';
  warning.classList.remove('show');

  return new Promise((resolve) => {
  const request = new XMLHttpRequest();
  request.open('POST', `/api/media?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(file.name)}`);
  request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
  request.upload.addEventListener('progress', (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
    $('#uploadProgressBar').style.width = `${percent}%`;
    $('#uploadProgressText').textContent = `${percent}%`;
  });
  request.upload.addEventListener('load', () => {
    $('#uploadProgressWrap').classList.add('preparing');
    $('#uploadCopy').textContent = kind === 'presentation' ? 'Opening document' : 'Checking file';
    $('#uploadProgressText').textContent = 'Preparing…';
    if (localPreview?.pending) $('#assetStatus').textContent = formatBytes(file.size);
  });
  const failUpload = (message) => {
    uploadBusy = false;
    releaseLocalPreview();
    $('#uploadProgressWrap').hidden = true;
    $('#uploadProgressWrap').classList.remove('preparing');
    render();
    warning.textContent = message;
    warning.classList.add('show');
    $('#adminAssetFile').value = '';
    resolve(null);
  };
  request.addEventListener('load', () => {
    let result;
    try { result = JSON.parse(request.responseText); } catch { failUpload('The server returned an invalid upload response. Try again.'); return; }
    if (request.status === 409 && ['uploading', 'checking'].includes(result.preparation?.phase)) {
      uploadBusy = false;
      status.state.preparation = result.preparation;
      const sameFile = result.preparation.name === file.name && result.preparation.size === file.size && result.preparation.kind === kind;
      if (!sameFile) releaseLocalPreview();
      $('#adminAssetFile').value = '';
      render();
      renderPreparation();
      resolve(null);
      return;
    }
    if (request.status < 200 || request.status >= 300 || !result.state?.asset) {
      failUpload(result.error || 'The file could not be prepared.');
      return;
    }
    uploadBusy = false;
    if (localPreview) {
      localPreview.pending = false;
      localPreview.assetVersion = result.state.asset.version;
      if (localPreview.failed) releaseLocalPreview();
    }
    // The upload response already contains the ready state; do not delay on a second request.
    status.state = result.state;
    updateServerTime(result.state);
    $('#uploadProgressWrap').classList.remove('preparing');
    $('#uploadProgressBar').style.width = '100%';
    $('#uploadCopy').textContent = 'File sent · loading displays';
    $('#uploadProgressText').textContent = 'Ready';
    uploadHideTimer = setTimeout(() => { $('#uploadProgressWrap').hidden = true; }, 1800);
    $('#adminAssetFile').value = '';
    render();
    resolve(result.state);
  });
  request.addEventListener('error', () => failUpload('The file transfer failed. Keep the CineWall server open and try again.'));
  request.addEventListener('abort', () => failUpload('Upload cancelled. Choose the file again to retry.'));
  request.send(file);
  });
}

// Drag and Drop functionality
const sourcePanel = $('.source-panel');
const dropZone = $('#dropZone');

function chooseDroppedFile() {
  if (sourceLocked() || uploadBusy || isPreparing() || $('#adminAssetFile').disabled || dropZone.hidden) return;
  $('#adminAssetFile').click();
}
dropZone.addEventListener('click', chooseDroppedFile);
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseDroppedFile(); }
});

function handleFileDrop(file) {
  if (!file || sourceLocked()) return;
  const sessionMode = status.state.sessionMode;
  const extension = file.name.toLowerCase().split('.').pop();

  // Validate file type
  let validType = false;
  if (sessionMode === 'video') {
    validType = ['mp4', 'webm', 'm4v', 'mkv'].includes(extension);
  } else if (sessionMode === 'audio') {
    validType = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'webm'].includes(extension);
  } else if (sessionMode === 'presentation') {
    const allowedExts = ['.pdf', '.ppt', '.pptx', '.pps', '.ppsx', '.odp', '.doc', '.docx', '.rtf', '.png', '.jpg', '.jpeg', '.webp', '.gif'];
    validType = allowedExts.some(ext => file.name.toLowerCase().endsWith(ext));
  }

  if (!validType) {
    warning.textContent = sessionMode === 'video' ? VIDEO_FORMAT_HELP : sessionMode === 'audio' ? 'This audio format is not supported by your browser. Try MP3, WAV or AAC audio.' : 'Choose a supported document.';
    warning.classList.add('show');
    return;
  }

  // Use the shared upload function
  uploadFile(file);
}

// Prevent default drag behaviors on entire document
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  document.body.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
  }, false);
});

// Highlight drop zone when file is dragged over the source panel
sourcePanel.addEventListener('dragenter', (e) => {
  if (Array.from(e.dataTransfer?.types || []).includes('text/x-cinewall-song')) return;
  if (sourceLocked() || status.state.sessionMode === 'youtube' || uploadBusy || isPreparing()) return;
  sourcePanel.classList.add('drag-active');
  dropZone.classList.add('drag-over');
});

sourcePanel.addEventListener('dragleave', (e) => {
  if (e.target === sourcePanel || !sourcePanel.contains(e.relatedTarget)) {
    sourcePanel.classList.remove('drag-active');
    dropZone.classList.remove('drag-over');
  }
});

sourcePanel.addEventListener('dragover', (e) => {
  if (Array.from(e.dataTransfer?.types || []).includes('text/x-cinewall-song')) return;
  if (sourceLocked() || status.state.sessionMode === 'youtube' || uploadBusy || isPreparing()) return;
  e.dataTransfer.dropEffect = 'copy';
});

sourcePanel.addEventListener('drop', (e) => {
  sourcePanel.classList.remove('drag-active');
  dropZone.classList.remove('drag-over');

  if (sourceLocked() || status.state.sessionMode === 'youtube' || uploadBusy || isPreparing()) return;

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    window.CineWallDownloadPanel?.chooseSource(false);
    if (status.state.sessionMode === 'audio') void audioQueue.queue.add(files);
    else handleFileDrop(files[0]);
  } else if (['video', 'audio'].includes(status.state.sessionMode)) {
    const link = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).trim();
    try {
      const url = new URL(link);
      if (['https:', 'http:'].includes(url.protocol) && /^(www\.|m\.|music\.)?(youtube\.com|youtu\.be)$/.test(url.hostname)) {
        window.CineWallDownloadPanel?.chooseSource(true);
        $('#downloadYoutubeUrl').value = url.href;
        $('#youtubeDownloadStatus').textContent = 'YouTube link added. Choose qualities to continue.';
      }
    } catch { /* Ignore non-file/non-YouTube drops. */ }
  }
});

$('#youtubeSourceForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = $('#youtubeUrl').value.trim();
  if (!url) return;
  warning.classList.remove('show');
  $('#loadYoutube').disabled = true;
  try {
    const result = await command({ type: 'load-youtube', url });
    if (result) $('#youtubeUrl').value = '';
  } catch (error) {
    warning.textContent = error.message || 'Could not load YouTube video';
    warning.classList.add('show');
  } finally {
    $('#loadYoutube').disabled = false;
  }
});

media.addEventListener('loadedmetadata', () => {
  duration = Number.isFinite(media.duration) ? media.duration : 0;
  timeline.max = duration || 100;
  $('#duration').textContent = duration ? formatTime(duration) : '--:--';
  if (localPreview && media.currentTime === 0 && duration > 0) media.currentTime = Math.min(.05, duration / 2);
  syncPreview();
});
media.addEventListener('timeupdate', () => {
  if (status.state.sessionMode === 'video') {
    captureSourcePoster();
    if (media.currentTime >= Math.min(10, media.duration || 10)) { media.pause(); if (media.currentTime > 10) media.currentTime = 10; }
    return;
  }
  if (!scrubbing) {
    timeline.value = media.currentTime || 0;
    $('#currentTime').textContent = formatTime(media.currentTime || 0);
  }
});
media.addEventListener('error', async () => {
  if (localPreview?.pending) {
    localPreview.failed = true;
    setPreviewKind();
    return;
  }
  const asset = status.state.asset;
  if (asset?.source === 'peer' && filePeer && [3, 4].includes(media.error?.code)) {
    if (previewRecoveryInFlight === asset.version) return;
    if (previewRecoveryVersion !== asset.version) { previewRecoveryVersion = asset.version; previewRecoveryAttempts = 0; }
    if (previewRecoveryAttempts < 2) {
      const attempt = ++previewRecoveryAttempts;
      previewRecoveryInFlight = asset.version;
      if (localPreview) releaseLocalPreview();
      loadedMediaVersion = asset.version;
      try {
        const options = { ranged: true, retry: attempt };
        if (attempt === 2) options.type = '';
        const url = await filePeer.open(asset, options);
        if (status.state.asset?.version !== asset.version) return;
        media.src = url;
        media.load();
        return;
      } catch (error) {
        if (status.state.asset?.version !== asset.version) return;
        warning.textContent = error.message;
        warning.classList.add('show');
        return;
      } finally {
        if (previewRecoveryInFlight === asset.version) previewRecoveryInFlight = '';
      }
    }
  }
  if (localPreview) { releaseLocalPreview(); setPreviewKind(); return; }
  if (!loadedMediaVersion) return;
  warning.textContent = window.CineWallFilePeer?.playbackHelp?.(asset) || VIDEO_FORMAT_HELP;
  warning.classList.add('show');
});

window.addEventListener('pagehide', releaseLocalPreview);
function startTrailer() { if (status.state.sessionMode !== 'video' || !media.getAttribute('src')) return; media.muted = true; media.loop = false; media.currentTime = 0; media.play().catch(() => {}); }
media.addEventListener('loadeddata', () => { captureSourcePoster(); if (trailerKey !== loadedMediaVersion) { trailerKey = loadedMediaVersion; startTrailer(); } });
media.addEventListener('seeked', captureSourcePoster);
media.addEventListener('ended', () => media.pause());
$('#replayPreview').addEventListener('click', startTrailer);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') $('#videoFormatInfo').open = false;
  if (event.target.isContentEditable || event.target.matches('input, textarea, select, summary, [contenteditable="true"]')) return;
  const focusedAction = event.target.closest?.('button, a');
  if (focusedAction && !['play', 'pause', 'back', 'forward', 'previousPage', 'nextPage'].includes(focusedAction.id)) return;
  if (status.state.sessionMode === 'presentation') {
    if (event.code === 'ArrowLeft') { event.preventDefault(); command({ type: 'previous-page' }); }
    else if (event.code === 'ArrowRight') { event.preventDefault(); command({ type: 'next-page' }); }
  } else {
    if (event.code === 'Space' && status.state.asset) {
      event.preventDefault();
      if (event.repeat) return;
      if (status.state.playing) command({ type: 'pause' });
      else playOnAdminDisplay();
    } else if (event.code === 'ArrowLeft') {
      event.preventDefault(); seekRelative(-10);
    } else if (event.code === 'ArrowRight') {
      event.preventDefault(); seekRelative(10);
    } else if (event.code === 'ArrowUp') {
      event.preventDefault();
      const currentVolume = audioSetting(1).volume;
      const newVolume = Math.min(1, currentVolume + 0.05);
      $('#adminVolume').value = newVolume;
      $('#adminVolumeValue').textContent = `${Math.round(newVolume * 100)}%`;
      media.volume = newVolume;
      queueVolume(1, newVolume);
    } else if (event.code === 'ArrowDown') {
      event.preventDefault();
      const currentVolume = audioSetting(1).volume;
      const newVolume = Math.max(0, currentVolume - 0.05);
      $('#adminVolume').value = newVolume;
      $('#adminVolumeValue').textContent = `${Math.round(newVolume * 100)}%`;
      media.volume = newVolume;
      queueVolume(1, newVolume);
    }
  }
  if (event.key.toLowerCase() === 'f') $('#previewStage').requestFullscreen().catch(() => {});
});

async function refresh() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const next = await response.json();
    status.screens = next.screens;
    acceptState(next.state);
    updateServerTime(status.state);
    $('#connection').classList.add('online');
    $('#connection span:last-child').textContent = 'Live sync';
    render();
  } catch {
    $('#connection').classList.remove('online');
    $('#connection span:last-child').textContent = 'Reconnecting';
  }
}

async function loadInfo() {
  connectionInfo = await (await fetch('/api/info', { cache: 'no-store' })).json();
  renderLinks();
  renderScreens();
  renderMixer();
}

const events = new EventSource('/events');
events.addEventListener('open', () => {
  $('#connection').classList.add('online');
  $('#connection span:last-child').textContent = 'Live sync';
  refresh();
});
events.addEventListener('error', () => {
  $('#connection').classList.remove('online');
  $('#connection span:last-child').textContent = 'Reconnecting';
});
events.addEventListener('state', (event) => {
  acceptState(JSON.parse(event.data));
  render();
});
events.addEventListener('screens', (event) => {
  status.screens = JSON.parse(event.data).screens;
  renderScreens();
  refresh();
});
events.addEventListener('pulse', (event) => {
  const previous = status.state;
  acceptState(JSON.parse(event.data));
  if (previous.commandId !== status.state.commandId || previous.asset?.version !== status.state.asset?.version || previous.ownerId !== status.state.ownerId || previous.allReady !== status.state.allReady || previous.preparation?.phase !== status.state.preparation?.phase || previous.serverId !== status.state.serverId) render();
  else { renderPreparation(); syncPreview(); }
});

function tickTimeline() {
  if (!scrubbing && status.state.sessionMode !== 'presentation') {
    const position = Math.min(duration || Infinity, positionNow());
    timeline.value = Number.isFinite(position) ? position : 0;
    $('#currentTime').textContent = formatTime(position);
  }
}
setInterval(syncPreview, 250);
if (typeof requestAnimationFrame === 'function') {
  const animate = () => { if (!document.hidden) tickTimeline(); requestAnimationFrame(animate); };
  requestAnimationFrame(animate);
} else setInterval(tickTimeline, 250);
setInterval(refresh, 2500);

async function bootstrap() {
  await Promise.allSettled([refresh(), loadInfo()]);
  if (validModes.includes(requestedMode) && requestedMode !== status.state.sessionMode) {
    await command({ type: 'session-mode', sessionMode: requestedMode });
  }
  render();
}

bootstrap();
