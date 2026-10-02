'use strict';

const $ = (selector) => document.querySelector(selector);
const media = $('#mediaPreview');
const timeline = $('#timeline');
const screenGrid = $('#screenGrid');
const screenLinks = $('#screenLinks');
const warning = $('#fileWarning');
const requestedMode = new URLSearchParams(location.search).get('mode');
const filePeer = window.CineWallFilePeer ? new window.CineWallFilePeer.FilePeer() : null;
const validModes = ['video', 'audio', 'presentation', 'youtube'];
const modeConfig = {
  video: {
    label: 'Video', icon: '&#xE714;', kicker: 'VIDEO SESSION', title: 'Video control room',
    subtitle: 'One movie, one timeline, every laptop perfectly in step.', source: 'Video file',
    choose: 'Choose your video', button: 'Choose video', accept: 'video/*,.mkv', min: 2, max: 3,
    map: 'Video wall map', assetLabel: 'Now playing', statusLabel: 'Playback', preview: 'VIDEO PREVIEW',
  },
  audio: {
    label: 'Audio', icon: '&#xE8D6;', kicker: 'AUDIO SESSION', title: 'Multi-speaker control room',
    subtitle: 'One track, up to five laptops, synchronized sound with individual volume.', source: 'Audio file',
    choose: 'Choose your audio', button: 'Choose audio', accept: 'audio/*,.flac,.m4a,.aac,.ogg', min: 1, max: 5,
    map: 'Speaker room map', assetLabel: 'Now playing', statusLabel: 'Playback', preview: 'AUDIO PREVIEW',
  },
  presentation: {
    label: 'Presentation', icon: '&#xE7F4;', kicker: 'PRESENTATION SESSION', title: 'Presenter control room',
    subtitle: 'One document, up to three audience displays, every page change in sync.', source: 'Presentation file',
    choose: 'Choose your presentation', button: 'Choose document', accept: '.pdf,.ppt,.pptx,.pps,.ppsx,.odp,.doc,.docx,.rtf,.png,.jpg,.jpeg,.webp,.gif', min: 1, max: 3,
    map: 'Audience display map', assetLabel: 'Now presenting', statusLabel: 'Current page', preview: 'PRESENTER PREVIEW',
  },
  youtube: {
    label: 'YouTube', icon: '&#xE768;', kicker: 'YOUTUBE SESSION', title: 'YouTube wall control room',
    subtitle: 'One YouTube link, one authoritative timeline, split across every display.', source: 'YouTube source',
    choose: 'Paste a YouTube link', button: 'Load YouTube', accept: '', min: 2, max: 3,
    map: 'YouTube wall map', assetLabel: 'Now playing', statusLabel: 'Playback', preview: 'YOUTUBE PREVIEW',
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
let mixerKey = '';
let trailerKey = '';
const volumeTimers = new Map();
let controlsQueue = Promise.resolve();
let controlSequence = 0;
const pendingControls = new Map();
const queuedRevisions = new Map();

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
  return ['uploading', 'checking', 'remuxing', 'converting'].includes(status.state.preparation?.phase);
}

function renderPreparation() {
  const job = status.state.preparation;
  const active = isPreparing();
  $('#cancelPreparation').hidden = !active || job.kind !== 'video';
  $('#cancelPreparation').disabled = cancelBusy;
  $('#adminAssetFile').disabled = uploadBusy || active || removeBusy;
  $('#playlistFiles').disabled = uploadBusy || active;
  if (!active) {
    if (!uploadBusy) $('#uploadProgressWrap').hidden = true;
    return;
  }
  clearTimeout(uploadHideTimer);
  $('#uploadProgressWrap').hidden = false;
  $('#uploadProgressWrap').classList.toggle('preparing', job.phase === 'checking');
  $('#uploadCopy').textContent = job.phase === 'uploading' ? `Uploading ${job.name}` : job.phase === 'checking' ? `Checking ${job.name}` : job.phase === 'remuxing' ? `Repackaging ${job.name} · original quality preserved` : `Converting ${job.name} with your permission`;
  $('#uploadProgressText').textContent = job.phase === 'checking' ? 'Checking…' : `${Math.min(['converting', 'remuxing'].includes(job.phase) ? 99 : 100, Math.round(job.progress || 0))}%`;
  $('#uploadProgressBar').style.width = `${job.progress || 0}%`;
  $('#assetTitle').textContent = job.name;
  $('#assetStatus').textContent = `${formatBytes(job.size)} · ${job.phase === 'uploading' ? 'Uploading' : 'Preparing for all laptops; no need to upload again'}`;
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
  localPreview = { file, kind, url: URL.createObjectURL(file), pending: true, assetVersion: '', failed: false };
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
  return Boolean(screen.ready && (!status.state.asset || screen.mediaReady));
}

function audioSetting(number) {
  return status.state.audioSettings?.[String(number)] || { volume: 1, muted: false };
}

function updateServerTime(state) {
  if (Number.isFinite(state.serverTime)) serverOffset = state.serverTime - Date.now();
}

async function command(payload) {
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
  } else if (['mute-all', 'youtube-audio-mode'].includes(payload.type)) {
    status.state.audioSettings = { ...state.audioSettings };
    for (let screen = 1; screen <= state.screenCount; screen++) {
      const patch = { ...audioSetting(screen), muted: payload.type === 'mute-all' ? Boolean(payload.muted) : payload.youtubeAudioMode !== 'all' && screen !== 1 };
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
  $('#navPlayerIcon').innerHTML = config.icon;
  $('#sessionKicker').textContent = config.kicker;
  $('#pageTitle').textContent = config.title;
  $('#pageSubtitle').textContent = config.subtitle;
  $('#sourceHeading').textContent = config.source;
  $('#sourceHeadingIcon').innerHTML = config.icon;
  $('#sourceIcon').innerHTML = config.icon;
  $('#screenMapTitle').textContent = config.map;
  $('#previewBadgeText').textContent = config.preview;
  $('#adminAssetFile').accept = config.accept;
  $('#adminFileLabel').textContent = state.asset ? `Change ${config.label.toLowerCase()}` : config.button;
  $('#framingPanel').hidden = state.sessionMode === 'audio';
  $('#audioMixerPanel').hidden = state.sessionMode === 'presentation';
  $('#presenterTips').hidden = state.sessionMode !== 'presentation';
  $('#mediaControls').hidden = state.sessionMode === 'presentation';
  $('#presentationControls').hidden = state.sessionMode !== 'presentation';
  $('#previewGesture').hidden = state.sessionMode !== 'video' || !state.asset;
  $('#playlistButton').hidden = state.sessionMode !== 'audio';
  $('#sharingChoice').hidden = !['video', 'audio'].includes(state.sessionMode);
  $('#sharingHint').hidden = !['video', 'audio'].includes(state.sessionMode);
  $('#conversionChoice').hidden = $('#sharingChoice').hidden || $('#sharingMethod').value !== 'server';
  $('#loopButton').hidden = state.sessionMode === 'presentation';
  $('#dropZone').hidden = state.sessionMode === 'youtube' || state.sessionMode === 'presentation' || (state.sessionMode === 'video' && !$('#youtubeDownloadPanel').hidden);

  // Update drop zone icon based on mode
  if (!$('#dropZone').hidden) {
    const dropIcon = $('#dropZone .drop-zone-icon');
    const dropText = $('#dropZone strong');
    dropIcon.innerHTML = config.icon;
    dropText.textContent = `Drop your ${state.sessionMode} file here`;
  }

  // Show/hide source inputs based on session mode
  const isYouTube = state.sessionMode === 'youtube';
  if (state.sessionMode !== 'video') $('#youtubeDownloadPanel').hidden = true;
  const downloadingYouTube = state.sessionMode === 'video' && !$('#youtubeDownloadPanel').hidden;
  $('#fileSourceButton').hidden = isYouTube || downloadingYouTube;
  $('#localVideoSource').classList.toggle('active', !downloadingYouTube);
  $('#localVideoSource').setAttribute('aria-pressed', String(!downloadingYouTube));
  $('#downloadYoutubeToggle').classList.toggle('active', downloadingYouTube);
  $('#downloadYoutubeToggle').setAttribute('aria-pressed', String(downloadingYouTube));
  $('#downloadYoutubeToggle').setAttribute('aria-expanded', String(downloadingYouTube));
  $('#youtubeSourceForm').hidden = !isYouTube;
  $('#videoSourceSelector').hidden = state.sessionMode !== 'video';
  $('#removeAsset').hidden = !state.asset;
  $('#removeAsset').disabled = uploadBusy || isPreparing() || removeBusy;
  $('#removeAsset').title = `Remove ${config.label.toLowerCase()}`;
  $('#removeAsset').setAttribute('aria-label', `Remove loaded ${config.label.toLowerCase()}`);
  $('#youtubeAudioMode').hidden = !isYouTube;
  $('#youtubeAudioMode').querySelectorAll('[data-youtube-audio]').forEach((button) => {
    button.classList.toggle('active', button.dataset.youtubeAudio === (state.youtubeAudioMode || 'admin'));
  });

  $('#framingHeading').textContent = state.sessionMode === 'presentation' ? 'Document framing' : state.sessionMode === 'youtube' ? 'YouTube wall framing' : 'Wall framing';
  $('#framingCopy').textContent = state.sessionMode === 'presentation' ? 'Choose how each page fills the combined display wall.' : state.sessionMode === 'youtube' ? 'Fit the full 16:9 frame or crop it across the combined wall.' : 'Control how the movie fills the combined canvas.';
  const framingLabels = state.sessionMode === 'presentation'
    ? { fit: 'Fit page', crop: 'Fill width', stretch: 'Stretch' }
    : { fit: 'Fit', crop: 'Cinema crop', stretch: 'Stretch' };
  $('#modeControls').querySelectorAll('[data-mode]').forEach((button) => {
    button.textContent = framingLabels[button.dataset.mode];
    button.hidden = ['presentation', 'youtube'].includes(state.sessionMode) && button.dataset.mode === 'stretch';
  });
  $('#modeControls').querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('active', button.dataset.mode === state.mode));

  if (state.sessionMode === 'presentation') {
    $('#shortcutHint').innerHTML = '<span><kbd>←</kbd><kbd>→</kbd> Change page</span><span>Expand opens Display 1</span><span>All displays follow automatically</span>';
  } else if (state.sessionMode === 'audio') {
    $('#shortcutHint').innerHTML = '<span><kbd>Space</kbd> Play / pause</span><span><kbd>←</kbd><kbd>→</kbd> Seek 10s</span><span>Volume is set per laptop below</span>';
  } else {
    $('#shortcutHint').innerHTML = '<span><kbd>Space</kbd> Play / pause</span><span><kbd>←</kbd><kbd>→</kbd> Seek 10s</span><span>Double-click left/right to seek</span>';
  }
}

function renderScreens() {
  const state = status.state;
  const screens = logicalScreens();
  screenGrid.style.gridTemplateColumns = `repeat(${Math.min(screens.length, 3)}, 1fr)`;
  const ready = screens.filter(isFullyReady).length;
  $('#readyCount').textContent = `${ready}/${screens.length} ready`;
  screenGrid.innerHTML = screens.map((screen) => {
    const fullyReady = isFullyReady(screen);
    const waitingLabel = state.sessionMode === 'youtube' ? 'Waiting for link' : 'Waiting for file';
    const loadingLabel = state.sessionMode === 'youtube' ? (screen.buffering ? 'Buffering' : 'Loading YouTube') : 'Loading file';
    const stateLabel = !screen.ready ? 'Not joined' : screen.error ? 'Needs attention' : !state.asset ? waitingLabel : !screen.mediaReady ? loadingLabel : screen.buffering ? 'Buffering' : state.playing && !screen.paused ? 'Playing' : screen.autoplayMuted ? 'Click for sound' : 'Ready';
    const outdated = screen.build && screen.build !== '2026.10.02-direct-10';
    const detail = screen.error || (outdated ? 'Reopen this laptop’s numbered link to update its player.' : state.asset?.name) || (screen.screen === 1 ? 'Open Display 1 on the admin laptop' : 'Open the assigned link on this laptop');
    const footer = state.sessionMode === 'presentation' && screen.ready ? `Page ${screen.page || state.page}` : fullyReady && state.sessionMode !== 'presentation' ? formatTime(screen.playbackTime) : '—';
    return `<article class="display-tile ${fullyReady ? 'ready' : ''}">
      <div class="display-tile-head"><span class="display-number">${screen.screen}</span><span class="display-state"><span class="status-dot"></span>${stateLabel}</span></div>
      <h3>${escapeHtml(screenRole(screen.screen))}</h3><p title="${escapeHtml(detail)}">${escapeHtml(detail)}</p><div class="display-time">${footer}</div>
    </article>`;
  }).join('');
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
  $('#linkScope').textContent = hosted ? 'Private session link' : 'Local network only';
  const noun = state.sessionMode === 'audio' ? 'speaker' : 'display';
  $('#linksHeading').textContent = state.sessionMode === 'audio' ? 'Speaker links' : 'Displays, pre-assigned';
  $('#linksCopy').textContent = state.sessionMode === 'audio' ? 'Open one link on every laptop you add. Speaker 1 is this admin laptop.' : 'Open each link on its matching laptop. Display 1 is this admin laptop.';
  $('#displayCountBadge').textContent = `${state.screenCount} / ${config.max} ${state.screenCount === 1 ? noun : `${noun}s`}`;
  $('#addDisplayLabel').textContent = `Add ${noun}`;
  $('#addDisplay').disabled = state.screenCount >= config.max;
  $('#addDisplay').title = state.screenCount >= config.max ? `Maximum ${config.max} ${noun}s reached` : `Add another ${noun}`;
  screenLinks.style.gridTemplateColumns = `repeat(${Math.min(state.screenCount, 3)}, 1fr)`;
  screenLinks.innerHTML = Array.from({ length: state.screenCount }, (_, index) => index + 1).map((number) => {
    const origin = number === 1 ? location.origin : baseRemote;
    const url = window.CineWallSession?.link(`/screen.html?screen=${number}`, origin) || `${origin}/screen.html?screen=${number}`;
    const role = screenRole(number, state.screenCount, state.sessionMode);
    const device = number === 1 ? 'This admin laptop' : `Laptop ${number}`;
    const removable = number === state.screenCount && state.screenCount > config.min;
    return `<article class="screen-link-card">
      <div class="link-card-head"><div class="screen-role"><span class="screen-role-icon fi">${config.icon}</span><div><strong>${escapeHtml(role)}</strong><small>${device}</small></div></div><div class="link-card-meta"><span class="display-number">${number}</span>${removable ? `<button class="remove-screen-button" data-remove-display="${number}" title="Remove last ${noun}" aria-label="Remove ${noun} ${number}"><span class="fi">&#xE711;</span></button>` : ''}</div></div>
      <code title="${escapeHtml(url)}">${escapeHtml(url)}</code>
      <div class="link-actions"><a href="${escapeHtml(url)}" target="_blank" rel="noopener"><span class="fi">&#xE8A7;</span>${number === 1 ? 'Open here' : 'Open link'}</a><button data-copy-link="${escapeHtml(url)}" title="Copy link" aria-label="Copy ${noun} ${number} link"><span class="fi">&#xE8C8;</span></button></div>
    </article>`;
  }).join('');
  const hotspot = connectionInfo.networks?.find((network) => network.isHotspot)?.address;
  $('#alternateLinks').textContent = hosted ? 'Share these private links only with your laptops. Keep the source admin tab open for direct local-file playback.' : hotspot && hotspot !== primaryAddress() ? `Using the admin laptop’s Mobile Hotspot? Replace ${primaryAddress()} with ${hotspot} in remote display links.` : 'All files and controls stay inside this local network.';
}

function renderMixer() {
  if (status.state.sessionMode === 'presentation') return;
  const settings = status.state.audioSettings || {};
  const key = `${status.state.sessionMode}:${status.state.screenCount}`;
  if (key !== mixerKey) {
  mixerKey = key;
  $('#speakerGrid').innerHTML = Array.from({ length: status.state.screenCount }, (_, index) => index + 1).map((number) => {
    const setting = settings[String(number)] || { volume: 1, muted: false };
    const percent = Math.round(setting.volume * 100);
    return `<div class="speaker-card ${setting.muted ? 'muted' : ''}" data-speaker="${number}">
      <div class="speaker-card-head"><span class="speaker-number">${number}</span><div><strong>${escapeHtml(screenRole(number))}</strong><small>${number === 1 ? 'Admin laptop' : `Laptop ${number}`}</small></div><button data-mute-screen="${number}" class="mini-icon-button" aria-label="${setting.muted ? 'Unmute' : 'Mute'} ${escapeHtml(screenRole(number))}"><span class="fi">${setting.muted ? '&#xE74F;' : '&#xE767;'}</span></button></div>
      <div class="speaker-slider"><input data-volume-screen="${number}" type="range" min="0" max="1" step="0.01" value="${setting.volume}" aria-label="${escapeHtml(screenRole(number))} volume"><output>${percent}%</output></div>
    </div>`;
  }).join('');
  }
  $('#speakerGrid').querySelectorAll('[data-speaker]').forEach((card) => {
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
      $('#previewEmptyTitle').textContent = $('#sharingMethod').value === 'direct' ? 'Browser cannot decode the original file' : 'Preparing a compatible preview';
      $('#previewEmptyCopy').textContent = $('#sharingMethod').value === 'direct' ? 'Try a compatible MP4, or choose Server compatibility copy. Re-encoding requires your permission and changes quality.' : 'The preview will appear when preparation finishes.';
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
  $('#previewEmptyCopy').textContent = isPresentation ? 'Your document appears here after local preparation.' : `Your ${state.sessionMode} appears here after preparation.`;

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
  $('#replayPreview').hidden = state.sessionMode !== 'video' || !(hasAsset || localPreview);
  if (hasAsset && state.asset.source === 'peer' && state.asset.duration && !duration) duration = state.asset.duration;
  $('#trackArt').innerHTML = config.icon;
  $('#trackKicker').textContent = state.sessionMode === 'presentation' ? 'NOW PRESENTING' : 'NOW PLAYING';
  $('#trackTitle').textContent = localPreview?.file.name || state.asset?.name || 'No file loaded';
  $('#assetTitle').textContent = localPreview?.file.name || state.asset?.name || config.choose;
  const preparedLabel = isYouTube ? 'Streaming from YouTube to every joined display' : state.asset?.converted === 'simplified' ? 'Simplified Office preview ready' : state.asset?.lossless ? 'Original-quality playback · no re-encoding' : state.asset?.converted ? (state.sessionMode === 'video' ? 'Compatibility conversion ready' : 'Converted to PDF and ready to present') : 'Streaming to every joined laptop';
  $('#assetStatus').textContent = state.asset ? (isYouTube ? `${preparedLabel}` : `${formatBytes(state.asset.size)} · ${preparedLabel}`) : state.sessionMode === 'presentation' ? 'PDF, PowerPoint, Word, and image files are prepared locally for the audience.' : state.sessionMode === 'youtube' ? 'Paste any YouTube URL above to load a video.' : `Choose the ${state.sessionMode} once here. CineWall streams it to every joined laptop.`;
  if (localPreview?.pending) $('#assetStatus').textContent = `${formatBytes(localPreview.file.size)} · Local file selected; preparing playback for connected screens`;
  if (state.asset?.source === 'peer') $('#assetStatus').textContent = `${formatBytes(state.asset.size)} · Original file, direct from this laptop · no server upload`;

  if (state.sessionMode === 'presentation') {
    $('#playerState').textContent = hasAsset ? `PAGE ${state.page}` : 'IDLE';
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
    loopEnabled = Boolean(state.loop);
    $('#loopButton').classList.toggle('active', loopEnabled);
    timeline.disabled = !hasAsset || uploadBusy || isPreparing();
    timeline.max = duration || 100;
    $('#duration').textContent = duration ? formatTime(duration) : isYouTube && hasAsset ? 'Loading...' : '--:--';
    syncPreview();
  }
  applyPreviewVolume();
  if (!scrubbing && state.sessionMode !== 'presentation') {
    timeline.value = Math.min(duration || Infinity, positionNow());
    $('#currentTime').textContent = formatTime(Number(timeline.value));
  }
}

function applyPreviewVolume() {
  media.muted = true;
}

function syncPreview() {
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
  renderScreens();
  renderLinks();
  renderMixer();
  renderPlayer();
  renderPreparation();
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
  const displayWindow = window.open(window.CineWallSession?.link('/screen.html?screen=1') || '/screen.html?screen=1', `cinewall-display-1-${window.CineWallSession?.room || 'lan'}`);
  displayWindow?.focus();
}

function playOnAdminDisplay() {
  openDisplayOne();
  command({ type: 'play', position: positionNow() });
}

$('#play').addEventListener('click', playOnAdminDisplay);
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
$('#previewFullscreen').addEventListener('click', openDisplayOne);
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
$('#youtubeAudioMode').addEventListener('click', (event) => {
  const button = event.target.closest('[data-youtube-audio]');
  if (button) command({ type: 'youtube-audio-mode', youtubeAudioMode: button.dataset.youtubeAudio });
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

$('#speakerGrid').addEventListener('input', (event) => {
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
$('#speakerGrid').addEventListener('click', (event) => {
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
  const file = $('#adminAssetFile').files[0];
  if (!file) return;
  uploadFile(file);
});

$('#playlistFiles').addEventListener('change', () => {
  const files = Array.from($('#playlistFiles').files);
  if (files.length === 0) return;
  warning.classList.remove('show');
  warning.textContent = `Playlist feature coming soon! Selected ${files.length} file(s). For now, use "Choose audio" to play one file at a time.`;
  warning.classList.add('show');
  $('#playlistFiles').value = '';
});

$('#removeAsset').addEventListener('click', async () => {
  if (!status.state.asset || uploadBusy || isPreparing() || removeBusy) return;
  removeBusy = true;
  renderModeShell();
  try {
    const result = await command({ type: 'clear-asset', assetVersion: status.state.asset.version });
    if (result) {
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

$('#sharingMethod').addEventListener('change', renderModeShell);
async function shareLocalFile(file) {
  uploadBusy = true;
  previewLocalFile(file, status.state.sessionMode);
  render();
  try {
    const state = await filePeer.publish(file, Number.isFinite(media.duration) ? media.duration : 0);
    status.state = state;
    if (localPreview) { localPreview.pending = false; localPreview.assetVersion = state.asset.version; }
    updateServerTime(state);
    $('#adminAssetFile').value = '';
  } catch (error) {
    releaseLocalPreview(); warning.textContent = error.message; warning.classList.add('show');
  } finally { uploadBusy = false; render(); }
}

// Shared upload function
function uploadFile(file) {
  if (!file || uploadBusy || removeBusy) return;
  if (isPreparing()) { renderPreparation(); return; }
  if (['video', 'audio'].includes(status.state.sessionMode) && $('#sharingMethod').value === 'direct' && filePeer) { shareLocalFile(file); return; }
  const kind = status.state.sessionMode;
  uploadBusy = true;
  clearTimeout(uploadHideTimer);
  previewLocalFile(file, kind);
  render();
  $('#uploadProgressWrap').hidden = false;
  $('#uploadProgressWrap').classList.remove('preparing');
  $('#uploadProgressBar').style.width = '0%';
  $('#uploadProgressText').textContent = '0%';
  $('#uploadCopy').textContent = `Uploading ${kind}`;
  warning.classList.remove('show');

  const request = new XMLHttpRequest();
  request.open('POST', `/api/media?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(file.name)}&reencode=${$('#allowReencode').checked ? '1' : '0'}`);
  request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
  request.upload.addEventListener('progress', (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
    $('#uploadProgressBar').style.width = `${percent}%`;
    $('#uploadProgressText').textContent = `${percent}%`;
  });
  request.upload.addEventListener('load', () => {
    $('#uploadProgressWrap').classList.add('preparing');
    $('#uploadCopy').textContent = kind === 'presentation' ? 'Preparing document locally' : 'Preparing playback for connected screens';
    $('#uploadProgressText').textContent = 'Preparing…';
    if (localPreview?.pending) $('#assetStatus').textContent = `${formatBytes(file.size)} · Uploaded; checking/converting for connected screens`;
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
  };
  request.addEventListener('load', () => {
    let result;
    try { result = JSON.parse(request.responseText); } catch { failUpload('The server returned an invalid upload response. Try again.'); return; }
    if (request.status === 409 && ['uploading', 'checking', 'remuxing', 'converting'].includes(result.preparation?.phase)) {
      uploadBusy = false;
      status.state.preparation = result.preparation;
      const sameFile = result.preparation.name === file.name && result.preparation.size === file.size && result.preparation.kind === kind;
      if (!sameFile) releaseLocalPreview();
      $('#adminAssetFile').value = '';
      render();
      renderPreparation();
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
    $('#uploadCopy').textContent = 'Ready on connected screens';
    $('#uploadProgressText').textContent = 'Ready';
    uploadHideTimer = setTimeout(() => { $('#uploadProgressWrap').hidden = true; }, 1800);
    $('#adminAssetFile').value = '';
    render();
  });
  request.addEventListener('error', () => failUpload('The file transfer failed. Keep the CineWall server open and try again.'));
  request.addEventListener('abort', () => failUpload('Upload cancelled. Choose the file again to retry.'));
  request.send(file);
}

// Drag and Drop functionality
const sourcePanel = $('.source-panel');
const dropZone = $('#dropZone');

function handleFileDrop(file) {
  if (!file) return;
  const sessionMode = status.state.sessionMode;

  // Validate file type
  let validType = false;
  if (sessionMode === 'video') {
    validType = file.type.startsWith('video/') || file.name.endsWith('.mkv');
  } else if (sessionMode === 'audio') {
    validType = file.type.startsWith('audio/') || ['.flac', '.m4a', '.aac', '.ogg'].some(ext => file.name.endsWith(ext));
  } else if (sessionMode === 'presentation') {
    const allowedExts = ['.pdf', '.ppt', '.pptx', '.pps', '.ppsx', '.odp', '.doc', '.docx', '.rtf', '.png', '.jpg', '.jpeg', '.webp', '.gif'];
    validType = allowedExts.some(ext => file.name.toLowerCase().endsWith(ext));
  }

  if (!validType) {
    warning.textContent = `Invalid file type. Please select a valid ${sessionMode} file.`;
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
  if (status.state.sessionMode === 'youtube' || uploadBusy || isPreparing()) return;
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
  if (status.state.sessionMode === 'youtube' || uploadBusy || isPreparing()) return;
  e.dataTransfer.dropEffect = 'copy';
});

sourcePanel.addEventListener('drop', (e) => {
  sourcePanel.classList.remove('drag-active');
  dropZone.classList.remove('drag-over');

  if (status.state.sessionMode === 'youtube' || uploadBusy || isPreparing()) return;

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleFileDrop(files[0]);
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
    if (media.currentTime >= Math.min(10, media.duration || 10)) { media.pause(); if (media.currentTime > 10) media.currentTime = 10; }
    return;
  }
  if (!scrubbing) {
    timeline.value = media.currentTime || 0;
    $('#currentTime').textContent = formatTime(media.currentTime || 0);
  }
});
media.addEventListener('error', () => {
  if (localPreview?.pending) {
    localPreview.failed = true;
    setPreviewKind();
    return;
  }
  if (localPreview) { releaseLocalPreview(); setPreviewKind(); return; }
  if (!loadedMediaVersion) return;
  warning.textContent = 'This browser cannot play the selected media format. MP4/H.264 video and MP3 audio work best.';
  warning.classList.add('show');
});

window.addEventListener('pagehide', releaseLocalPreview);
function startTrailer() { if (status.state.sessionMode !== 'video' || !media.getAttribute('src')) return; media.muted = true; media.loop = false; media.currentTime = 0; media.play().catch(() => {}); }
media.addEventListener('loadeddata', () => { if (trailerKey !== loadedMediaVersion) { trailerKey = loadedMediaVersion; startTrailer(); } });
media.addEventListener('ended', () => media.pause());
$('#replayPreview').addEventListener('click', startTrailer);

document.addEventListener('keydown', (event) => {
  if (event.target.matches('input, button, a')) return;
  if (status.state.sessionMode === 'presentation') {
    if (event.code === 'ArrowLeft') { event.preventDefault(); command({ type: 'previous-page' }); }
    else if (event.code === 'ArrowRight') { event.preventDefault(); command({ type: 'next-page' }); }
  } else {
    if (event.code === 'Space' && status.state.asset) {
      event.preventDefault();
      command(status.state.playing ? { type: 'pause' } : { type: 'play', position: positionNow() });
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
  if (status.state.sessionMode === 'youtube') renderPlayer();
});
events.addEventListener('pulse', (event) => {
  const previous = status.state;
  acceptState(JSON.parse(event.data));
  if (previous.commandId !== status.state.commandId || previous.asset?.version !== status.state.asset?.version || previous.preparation?.phase !== status.state.preparation?.phase || previous.serverId !== status.state.serverId) render();
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
