'use strict';

const CLIENT_BUILD = '2026.10.02-direct-10';
const filePeer = window.CineWallFilePeer ? new window.CineWallFilePeer.FilePeer() : null;
const $ = (selector) => document.querySelector(selector);
const video = $('#video');
const stage = $('#wallStage');
const youtubeViewport = $('#youtubeViewport');
const youtubeWall = $('#youtubeWall');
const speakerStage = $('#speakerStage');
const documentWall = $('#documentWall');
const documentFrame = $('#documentFrame');
const documentImage = $('#documentImage');
const pdfCanvas = $('#pdfCanvas');
const setup = $('#setup');
const picker = $('#screenPicker');
const readyButton = $('#readyButton');
const screenControls = $('#screenControls');
const screenTimeline = $('#screenTimeline');
const waitingAsset = $('#waitingAsset');
const networkLabel = $('#networkLabel');
const connectionLost = $('#connectionLost');
const playBlocked = $('#playBlocked');

const requestedScreen = Number(new URLSearchParams(location.search).get('screen'));
let screenNumber = [1, 2, 3, 4, 5].includes(requestedScreen) ? requestedScreen : Number(localStorage.getItem('cinewall-screen')) || 0;
let wallScreens = 3;
let sessionMode = 'video';
let ready = false;
let serverOffset = 0;
let currentState = null;
let currentAssetVersion = '';
let documentKey = '';
let documentReady = false;
let pdfModulePromise = null;
let pdfDocument = null;
let pdfAssetVersion = '';
let pdfRenderTask = null;
let pdfRenderToken = 0;
let mediaLoadAttempts = 0;
let mediaLoadTimer = null;
let controlsTimer = null;
let lastError = '';
let scrubbing = false;
let youtubePlayer = null;
let youtubeReady = false;
let youtubeVideoId = null;
let youtubeRetryCount = 0;
let youtubeRetryTimer = null;
let youtubeStartCheckTimer = null;
let youtubeLastSeek = 0;
let localAutoplayMuted = false;
let playbackAttempt = null;
let wallMode = 'crop';
let disconnectTimer = null;
let lastServerContact = Date.now();
let localControlSequence = 0;
let localControlsQueue = Promise.resolve();
let localPlaybackIntent = null;
let localVolumeTimer = null;
let localVolumeRevision = 0;
const generatedId = globalThis.crypto?.randomUUID?.() || `screen-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clientId = sessionStorage.getItem('cinewall-client-id') || generatedId;
sessionStorage.setItem('cinewall-client-id', clientId);

const modeDetails = {
  video: { icon: '&#xE714;', setup: 'JOIN THE VIDEO WALL', noun: 'display', title: 'Choose this<br><em>display position</em>', copy: 'Confirm this laptop’s place in the wall, then enter fullscreen. The admin sends the movie automatically.' },
  audio: { icon: '&#xE8D6;', setup: 'JOIN THE SPEAKER ROOM', noun: 'speaker', title: 'Choose this<br><em>speaker number</em>', copy: 'Confirm this laptop’s speaker number. The admin controls the track, timing, volume, and mute state.' },
  presentation: { icon: '&#xE7F4;', setup: 'JOIN THE PRESENTATION', noun: 'display', title: 'Choose this<br><em>audience display</em>', copy: 'Confirm this audience display, then enter fullscreen. Every page follows the admin automatically.' },
  youtube: { icon: '&#xE768;', setup: 'JOIN THE YOUTUBE WALL', noun: 'display', title: 'Choose this<br><em>YouTube display</em>', copy: 'Confirm this laptop’s place in the wall. The admin controls one synchronized YouTube player across every display.' },
};

function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return '--:--';
  const total = Math.floor(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function markConnectionLive() {
  lastServerContact = Date.now();
  clearTimeout(disconnectTimer);
  disconnectTimer = null;
  networkLabel.classList.add('online');
  networkLabel.querySelector('span:last-child').textContent = 'Live';
  connectionLost.classList.remove('show');
}

function markConnectionReconnecting() {
  networkLabel.classList.remove('online');
  networkLabel.querySelector('span:last-child').textContent = 'Reconnecting';
  if (disconnectTimer) return;
  disconnectTimer = setTimeout(() => {
    disconnectTimer = null;
    if (Date.now() - lastServerContact >= 10000) connectionLost.classList.add('show');
  }, 10000);
}

function screenRole(number) {
  if (sessionMode === 'audio') return number === 1 ? 'Admin speaker' : `Speaker ${number}`;
  if (sessionMode === 'presentation' && wallScreens === 1) return 'Admin · Full page';
  if (wallScreens === 2) return number === 1 ? 'Left · Admin' : 'Right';
  return ['', 'Left · Admin', 'Centre', 'Right'][number] || `Display ${number}`;
}

function renderScreenChoices() {
  picker.style.gridTemplateColumns = `repeat(${Math.min(wallScreens, 3)}, 1fr)`;
  picker.innerHTML = Array.from({ length: wallScreens }, (_, index) => {
    const number = index + 1;
    return `<button class="screen-choice ${number === screenNumber ? 'selected' : ''}" data-screen="${number}"><strong>${number}</strong>${screenRole(number)}</button>`;
  }).join('');
}

function selectScreen(value) {
  const next = Number(value);
  if (!Number.isInteger(next) || next < 1 || next > wallScreens) return;
  screenNumber = next;
  localStorage.setItem('cinewall-screen', String(screenNumber));
  stage.style.setProperty('--screen-index', screenNumber - 1);
  youtubeWall.style.setProperty('--screen-index', screenNumber - 1);
  documentWall.style.setProperty('--screen-index', screenNumber - 1);
  $('#speakerNumber').textContent = screenNumber;
  renderScreenChoices();
  updateLabels();
  updateReadyButton();
  applyAudioSettings();
  postStatus();
}

function setLayout(count) {
  wallScreens = Math.min(5, Math.max(1, Number(count) || 3));
  stage.style.setProperty('--wall-screens', wallScreens);
  youtubeWall.style.setProperty('--wall-screens', wallScreens);
  documentWall.style.setProperty('--wall-screens', wallScreens);
  if (screenNumber > wallScreens) {
    screenNumber = 0;
    ready = false;
    localStorage.removeItem('cinewall-screen');
    setup.classList.remove('hidden');
  }
  if (!screenNumber && requestedScreen && requestedScreen <= wallScreens) {
    screenNumber = requestedScreen;
    ready = true;
    localStorage.setItem('cinewall-screen', String(screenNumber));
    setup.classList.add('hidden');
  }
  if (screenNumber) {
    stage.style.setProperty('--screen-index', screenNumber - 1);
    youtubeWall.style.setProperty('--screen-index', screenNumber - 1);
    documentWall.style.setProperty('--screen-index', screenNumber - 1);
  }
  renderScreenChoices();
  updateLabels();
  updateReadyButton();
}

function updateLabels() {
  const details = modeDetails[sessionMode];
  document.body.dataset.sessionMode = sessionMode;
  $('#screenBrandIcon').innerHTML = details.icon;
  $('#screenLabel').textContent = screenNumber ? `${sessionMode === 'audio' ? 'Speaker' : 'Display'} ${screenNumber} · ${screenRole(screenNumber)}` : `${details.noun} not ready`;
  $('#setupModeLabel').textContent = `${details.noun[0].toUpperCase()}${details.noun.slice(1)} setup`;
  $('#setupKicker').textContent = details.setup;
  $('#setupHeading').innerHTML = details.title;
  $('#setupDescription').textContent = details.copy;
  $('#setupHint').textContent = sessionMode === 'audio' ? 'Speaker 1 is the admin laptop. Every laptop still needs one click to allow browser audio.' : sessionMode === 'presentation' ? 'Display 1 is the admin laptop and includes page controls.' : sessionMode === 'youtube' ? 'Display 1 is the admin laptop. Join once on every laptop so YouTube can play and sync.' : 'Display 1 is the admin laptop and includes playback controls.';
  $('#readyButtonLabel').textContent = sessionMode === 'audio' ? 'Enable audio & join speaker room' : 'Enter fullscreen & join';
  $('#waitingIcon').innerHTML = details.icon;
  $('#waitingTitle').textContent = 'Waiting for the admin';
  $('#waitingCopy').textContent = sessionMode === 'presentation' ? 'The document will appear here automatically.' : sessionMode === 'youtube' ? 'The YouTube video will appear here automatically.' : `The ${sessionMode} will appear here automatically.`;
  $('#screenMediaControls').hidden = sessionMode === 'presentation';
  $('#screenPresentationControls').hidden = sessionMode !== 'presentation';
  $('#screenShortcuts').textContent = sessionMode === 'presentation' ? '← → · Change page   F · Fullscreen' : ['video', 'youtube'].includes(sessionMode) ? 'Space · Play/Pause   ← → · Seek   Double-click sides · 10s   F · Fullscreen' : 'Space · Play/Pause   ← → · Seek   F · Fullscreen';
  $('#screenGesture').hidden = !(['video', 'youtube'].includes(sessionMode) && screenNumber === 1 && ready && currentState?.asset);
  screenControls.classList.toggle('available', screenNumber === 1 && ready);
}

function updateReadyButton() {
  readyButton.disabled = !screenNumber || screenNumber > wallScreens;
}

function setWallMode(mode) {
  wallMode = mode === 'fit' ? 'fit' : 'crop';
  stage.classList.remove('mode-fit', 'mode-crop', 'mode-stretch');
  documentWall.classList.remove('mode-fit', 'mode-crop', 'mode-stretch');
  stage.classList.add(`mode-${mode}`);
  documentWall.classList.add(`mode-${mode}`);
  sizeYouTubeWall();
}

function sizeYouTubeWall() {
  const frame = $('#youtubePlayerFrame');
  if (!frame) return;
  const wallWidth = Math.max(1, innerWidth * wallScreens);
  const wallHeight = Math.max(1, innerHeight);
  const videoRatio = 16 / 9;
  const wallRatio = wallWidth / wallHeight;
  let width;
  let height;
  if ((wallMode === 'fit' && wallRatio > videoRatio) || (wallMode !== 'fit' && wallRatio < videoRatio)) {
    height = wallHeight;
    width = height * videoRatio;
  } else {
    width = wallWidth;
    height = width / videoRatio;
  }
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  frame.style.left = `${(wallWidth - width) / 2}px`;
  frame.style.top = `${(wallHeight - height) / 2}px`;
}

function audioSetting() {
  return currentState?.audioSettings?.[String(screenNumber)] || { volume: 1, muted: false };
}

function applyAudioSettings() {
  const setting = { ...audioSetting() };
  const slider = $('#screenVolume');
  if (document.activeElement === slider || localVolumeTimer) setting.volume = Number(slider.value);
  const isYouTube = sessionMode === 'youtube';

  if (isYouTube && youtubePlayer && youtubeReady) {
    youtubePlayer.setVolume(setting.volume);
    youtubePlayer.setMuted(setting.muted);
  } else {
    video.volume = Math.min(1, Math.max(0, Number(setting.volume) || 0));
    video.muted = sessionMode === 'presentation' || localAutoplayMuted || Boolean(setting.muted);
  }

  $('#screenMute').innerHTML = `<span class="fi">${setting.muted ? '&#xE74F;' : '&#xE767;'}</span>`;
  $('#screenMute').classList.toggle('active', Boolean(setting.muted));
  $('#screenVolume').value = setting.volume;
  $('#screenVolumeValue').textContent = `${Math.round(setting.volume * 100)}%`;
}

function presentationUrl(asset, page, mode) {
  const path = `/api/media/stream?v=${encodeURIComponent(asset.version)}&screen=${screenNumber}`;
  const base = window.CineWallSession?.link(path) || path;
  if (asset.renderType === 'html') return `${base}#page=${page}`;
  return base;
}

async function pdfLibrary() {
  if (!pdfModulePromise) {
    pdfModulePromise = import('/vendor/pdfjs/pdf.min.mjs').then((module) => {
      module.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
      return module;
    });
  }
  return pdfModulePromise;
}

async function renderPdf(asset, pageNumber, mode) {
  const renderToken = ++pdfRenderToken;
  try {
    const pdfjs = await pdfLibrary();
    if (!pdfDocument || pdfAssetVersion !== asset.version) {
      if (pdfRenderTask) {
        pdfRenderTask.cancel();
        await pdfRenderTask.promise.catch(() => {});
        pdfRenderTask = null;
      }
      if (pdfDocument) await pdfDocument.destroy().catch(() => {});
      const path = `/api/media/stream?v=${encodeURIComponent(asset.version)}`;
      const loadedDocument = await pdfjs.getDocument({ url: window.CineWallSession?.link(path) || path }).promise;
      if (renderToken !== pdfRenderToken) {
        await loadedDocument.destroy().catch(() => {});
        return;
      }
      pdfDocument = loadedDocument;
      pdfAssetVersion = asset.version;
    }
    if (pdfRenderTask) {
      pdfRenderTask.cancel();
      await pdfRenderTask.promise.catch(() => {});
      pdfRenderTask = null;
    }
    const page = await pdfDocument.getPage(Math.min(Math.max(1, pageNumber), pdfDocument.numPages));
    if (renderToken !== pdfRenderToken) return;
    const natural = page.getViewport({ scale: 1 });
    const wallWidth = Math.max(1, innerWidth * wallScreens);
    const wallHeight = Math.max(1, innerHeight);
    const fitScale = Math.min(wallWidth / natural.width, wallHeight / natural.height);
    const fillScale = wallWidth / natural.width;
    const cssScale = mode === 'fit' ? fitScale : fillScale;
    const cssWidth = natural.width * cssScale;
    const cssHeight = mode === 'stretch' ? wallHeight : natural.height * cssScale;
    const renderCssHeight = natural.height * cssScale;
    const requestedDpr = Math.min(devicePixelRatio || 1, 2);
    const pixelBudgetDpr = Math.sqrt(6_000_000 / Math.max(1, cssWidth * renderCssHeight));
    const renderDpr = Math.min(requestedDpr, pixelBudgetDpr);
    const viewport = page.getViewport({ scale: cssScale * renderDpr });
    pdfCanvas.width = Math.ceil(viewport.width);
    pdfCanvas.height = Math.ceil(viewport.height);
    pdfCanvas.style.width = `${cssWidth}px`;
    pdfCanvas.style.height = `${cssHeight}px`;
    pdfCanvas.style.left = `${(wallWidth - cssWidth) / 2}px`;
    pdfCanvas.style.top = mode === 'crop' ? '0px' : `${(wallHeight - cssHeight) / 2}px`;
    const context = pdfCanvas.getContext('2d', { alpha: false });
    context.save();
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, pdfCanvas.width, pdfCanvas.height);
    context.restore();
    pdfRenderTask = page.render({ canvasContext: context, viewport });
    await pdfRenderTask.promise;
    if (renderToken !== pdfRenderToken) return;
    documentReady = true;
    lastError = '';
    waitingAsset.classList.remove('show');
    postStatus();
  } catch (error) {
    if (error?.name === 'RenderingCancelledException') return;
    console.error('CineWall PDF render failed', error);
    documentReady = false;
    lastError = 'This PDF could not be rendered on this display.';
    postStatus();
  }
}

function loadPresentation(asset, page, mode = 'fit') {
  if (!asset) {
    documentKey = '';
    documentReady = false;
    pdfRenderToken += 1;
    pdfCanvas.width = 0;
    pdfCanvas.height = 0;
    documentFrame.removeAttribute('src');
    documentImage.removeAttribute('src');
    return;
  }
  const nextKey = `${asset.version}:${page}:${mode}:${wallScreens}`;
  if (nextKey === documentKey) return;
  documentKey = nextKey;
  documentReady = false;
  if (asset.renderType === 'pdf') renderPdf(asset, page, mode);
  else if (asset.renderType === 'image') documentImage.src = presentationUrl(asset, page, mode);
  else documentFrame.src = presentationUrl(asset, page, mode);
  postStatus();
}

function loadMedia(asset, force = false) {
  if (!asset) {
    if (!currentAssetVersion && !video.getAttribute('src')) return;
    currentAssetVersion = '';
    clearTimeout(mediaLoadTimer);
    video.pause();
    video.removeAttribute('src');
    video.load();
    return;
  }
  if (asset.version === currentAssetVersion && !force) return;
  if (asset.version !== currentAssetVersion) mediaLoadAttempts = 0;
  currentAssetVersion = asset.version;
  mediaLoadAttempts += 1;
  lastError = '';
  video.pause();
  if (asset.source === 'peer' && filePeer) {
    const version = asset.version;
    $('#localPeerFileChoice').hidden = true;
    filePeer.open(asset).then((url) => { if (currentAssetVersion === version) { video.src = url; video.load(); } }).catch((error) => { if (currentAssetVersion !== version) return; lastError = error.message; $('#localPeerFileChoice').hidden = false; $('#waitingTitle').textContent = 'Select the same movie or reconnect'; $('#waitingCopy').textContent = error.message; waitingAsset.classList.add('show'); postStatus(); });
    return;
  }
  $('#localPeerFileChoice').hidden = true;
  video.src = window.CineWallSession?.link(`/api/media/stream?v=${encodeURIComponent(asset.version)}&screen=${screenNumber}&attempt=${mediaLoadAttempts}`) || `/api/media/stream?v=${encodeURIComponent(asset.version)}&screen=${screenNumber}&attempt=${mediaLoadAttempts}`;
  video.load();
  postStatus();
  clearTimeout(mediaLoadTimer);
  mediaLoadTimer = setTimeout(() => {
    if (currentAssetVersion === asset.version && !Number.isFinite(video.duration) && mediaLoadAttempts < 5) loadMedia(asset, true);
  }, 6000);
}

function scheduleYouTubeRetry(videoId) {
  if (!ready || sessionMode !== 'youtube' || currentState?.asset?.videoId !== videoId || youtubeRetryCount >= 3) return;
  clearTimeout(youtubeRetryTimer);
  const delay = [1500, 4000, 8000][youtubeRetryCount] || 8000;
  youtubeRetryCount += 1;
  youtubeRetryTimer = setTimeout(() => initYouTubePlayer(videoId, true), delay);
}

function verifyYouTubePlayback(videoId) {
  if (youtubeStartCheckTimer) return;
  youtubeStartCheckTimer = setTimeout(() => {
    youtubeStartCheckTimer = null;
    if (!ready || !currentState?.playing || sessionMode !== 'youtube' || youtubeVideoId !== videoId || youtubePlayer?.getState() === 1 || youtubePlayer?.getState() === 3) return;
    if (!lastError) {
      playBlocked.classList.add('show');
      lastError = 'Click once on this laptop to allow YouTube playback.';
      postStatus();
    }
  }, 5000);
}

async function initYouTubePlayer(videoId, force = false) {
  youtubeVideoId = videoId;
  if (!window.CineWallYouTubeProvider) {
    lastError = 'YouTube player library not loaded';
    postStatus();
    return;
  }
  if (force && youtubePlayer) {
    try { youtubePlayer.destroy(); } catch {}
    youtubePlayer = null;
    youtubeReady = false;
  }
  if (youtubePlayer) {
    try {
      lastError = '';
      await youtubePlayer.cue(videoId);
      youtubeVideoId = videoId;
      currentAssetVersion = currentState?.asset?.version || `youtube-${videoId}`;
      sizeYouTubeWall();
      return;
    } catch {}
  }
  youtubeWall.innerHTML = '<div id="youtubePlayerFrame" class="youtube-player-frame"><div id="youtubePlayerContainer"></div></div>';
  sizeYouTubeWall();
  youtubeReady = false;
  youtubeVideoId = videoId;
  try {
    youtubePlayer = new window.CineWallYouTubeProvider('youtubePlayerContainer', {
      onReady: () => {
        youtubeReady = true;
        clearTimeout(youtubeRetryTimer);
        lastError = '';
        sizeYouTubeWall();
        applyAudioSettings();
        waitingAsset.classList.remove('show');
        postStatus();
        if (currentState) correctDrift(currentState);
        if (ready && currentState?.playing) verifyYouTubePlayback(videoId);
      },
      onStateChange: (playerState) => {
        if ([0, 1, 2, 3, 5].includes(Number(playerState))) {
          youtubeReady = true;
          lastError = '';
          waitingAsset.classList.remove('show');
        }
        if (Number(playerState) === 1) {
          youtubeRetryCount = 0;
          playBlocked.classList.remove('show');
        }
        if (Number(playerState) === 0 && screenNumber === 1 && currentState?.playing && youtubePlayer.getCurrentTime() >= youtubePlayer.getDuration() - .5) command(currentState.loop ? { type: 'play', position: 0 } : { type: 'pause' });
        postStatus();
      },
      onAutoplayBlocked: () => {
        playBlocked.classList.add('show');
        lastError = 'Click once on this laptop to allow YouTube playback.';
        postStatus();
      },
      onError: (error) => {
        youtubeReady = false;
        const messages = {
          2: 'This YouTube address is not valid.',
          5: 'This YouTube video cannot play in the HTML player.',
          100: 'This YouTube video is private, removed, or unavailable.',
          101: 'The video owner has disabled playback on other websites.',
          150: 'The video owner has disabled playback on other websites.',
          153: 'YouTube cannot verify this display. Reload the numbered display link in Chrome or Edge.',
        };
        const retryable = error === -1 || error === 5;
        lastError = retryable && youtubeRetryCount < 3 ? 'YouTube is reconnecting on this laptop…' : messages[error] || 'YouTube could not load this video. Check the link and internet connection.';
        postStatus();
        if (retryable && youtubeRetryCount < 3) scheduleYouTubeRetry(videoId);
        else {
          $('#waitingTitle').textContent = 'YouTube could not play';
          $('#waitingCopy').textContent = lastError;
          waitingAsset.classList.add('show');
        }
      },
    });
    await youtubePlayer.cue(videoId, 0);
    currentAssetVersion = currentState?.asset?.version || `youtube-${videoId}`;
  } catch (error) {
    lastError = error.message || 'YouTube player failed to initialize';
    youtubeReady = false;
    postStatus();
    if (youtubeRetryCount < 3) scheduleYouTubeRetry(videoId);
    else {
      $('#waitingTitle').textContent = 'YouTube could not load';
      $('#waitingCopy').textContent = lastError;
      waitingAsset.classList.add('show');
    }
  }
}

function applyStateAppearance(nextState) {
  if (currentState && nextState.serverId === currentState.serverId && nextState.commandId < currentState.commandId) return;
  if (localPlaybackIntent) {
    if (localPlaybackIntent.assetVersion === nextState.asset?.version && localPlaybackIntent.serverId === nextState.serverId) nextState = { ...nextState, ...localPlaybackIntent.patch };
    else localPlaybackIntent = null;
  }
  currentState = nextState;
  sessionMode = nextState.sessionMode || 'video';
  setLayout(nextState.screenCount);
  setWallMode(nextState.mode || 'crop');
  applyAudioSettings();

  const hasAsset = Boolean(nextState.asset);
  const isYouTube = sessionMode === 'youtube';
  stage.hidden = sessionMode !== 'video';
  youtubeViewport.hidden = !isYouTube;
  speakerStage.hidden = sessionMode !== 'audio';
  documentWall.hidden = sessionMode !== 'presentation' || !hasAsset;
  documentFrame.hidden = sessionMode !== 'presentation' || !hasAsset || nextState.asset.renderType !== 'html';
  documentImage.hidden = sessionMode !== 'presentation' || !hasAsset || nextState.asset.renderType !== 'image';
  pdfCanvas.hidden = sessionMode !== 'presentation' || !hasAsset || nextState.asset.renderType !== 'pdf';
  speakerStage.classList.toggle('playing', Boolean(nextState.playing));
  $('#speakerTitle').textContent = nextState.asset?.name || 'Waiting for audio';
  $('#speakerSubtitle').textContent = nextState.playing ? `Playing on Speaker ${screenNumber}` : nextState.asset ? 'Paused by the admin' : 'The admin controls playback and volume.';

  if (!hasAsset) {
    filePeer?.clear();
    $('#localPeerFileChoice').hidden = true;
    lastError = '';
    localAutoplayMuted = false;
    playBlocked.classList.remove('show');
    loadMedia(null);
    loadPresentation(null);
    clearTimeout(youtubeRetryTimer);
    clearTimeout(youtubeStartCheckTimer);
    youtubeRetryCount = 0;
    if (youtubePlayer) { try { youtubePlayer.destroy(); } catch {} }
    youtubePlayer = null;
    youtubeReady = false;
    youtubeVideoId = null;
  } else if (sessionMode === 'presentation') {
    currentAssetVersion = nextState.asset?.version || '';
    video.pause();
    loadPresentation(nextState.asset, nextState.page || 1, nextState.mode || 'fit');
  } else if (isYouTube && hasAsset && nextState.asset.videoId) {
    video.pause();
    if (youtubeVideoId !== nextState.asset.videoId) {
      youtubeRetryCount = 0;
      clearTimeout(youtubeRetryTimer);
      clearTimeout(youtubeStartCheckTimer);
      initYouTubePlayer(nextState.asset.videoId);
    }
  } else if (isYouTube) {
    video.pause();
  } else {
    documentKey = '';
    documentReady = false;
    if (youtubePlayer) {
      try {
        youtubePlayer.destroy();
      } catch {}
      youtubePlayer = null;
      youtubeReady = false;
      youtubeVideoId = null;
    }
    clearTimeout(youtubeRetryTimer);
    clearTimeout(youtubeStartCheckTimer);
    youtubeRetryCount = 0;
    youtubeVideoId = null;
    loadMedia(nextState.asset);
  }
  const fatalError = Boolean(lastError && !playBlocked.classList.contains('show'));
  waitingAsset.classList.toggle('show', ready && (!hasAsset || fatalError));
  updateLabels();
  if (fatalError) {
    $('#waitingTitle').textContent = 'Playback needs attention';
    $('#waitingCopy').textContent = lastError;
  }
  updateController();
}

function serverNow() {
  return Date.now() + serverOffset;
}

function targetPosition(playbackState, at = serverNow()) {
  if (!playbackState?.playing) return playbackState?.position || 0;
  return Math.max(0, (playbackState.position || 0) + Math.max(0, at - playbackState.anchorTime) / 1000);
}

function seekTo(position) {
  if (!Number.isFinite(video.duration)) return;
  const safe = Math.min(Math.max(0, position), Math.max(0, video.duration - 0.04));
  if (Math.abs(video.currentTime - safe) > 0.025) video.currentTime = safe;
}

async function command(payload) {
  const sequence = ++localControlSequence;
  const volumeRevision = payload.type === 'screen-audio' && 'volume' in payload ? ++localVolumeRevision : 0;
  if (currentState && ['play', 'pause', 'seek', 'restart'].includes(payload.type)) {
    const position = payload.type === 'restart' ? 0 : Number.isFinite(payload.position) ? payload.position : targetPosition(currentState);
    const patch = { position, anchorTime: serverNow(), notBefore: 0, playing: payload.type === 'play' ? true : ['pause', 'restart'].includes(payload.type) ? false : currentState.playing };
    localPlaybackIntent = { sequence, patch, assetVersion: currentState.asset?.version, serverId: currentState.serverId };
    execute({ ...currentState, ...patch, type: payload.type });
  }
  const send = async () => {
    if (volumeRevision && volumeRevision !== localVolumeRevision) return;
    try {
    const response = await fetch('/api/command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Control could not be sent');
    if (localPlaybackIntent?.sequence === sequence) localPlaybackIntent = null;
    schedule(result.command);
    return result.command;
    } catch (error) {
      if (localPlaybackIntent?.sequence === sequence) localPlaybackIntent = null;
      lastError = error.message; fetchInitialState(); postStatus();
    }
  };
  const result = localControlsQueue.then(send, send);
  localControlsQueue = result.catch(() => {});
  return result;
}

async function playLocalMedia() {
  if (playbackAttempt) return playbackAttempt;
  playbackAttempt = (async () => {
    try {
      await video.play();
      if (!localAutoplayMuted) playBlocked.classList.remove('show');
    } catch (error) {
      if (error.name === 'NotAllowedError') {
        localAutoplayMuted = true;
        video.muted = true;
        try {
          await video.play();
          playBlocked.textContent = sessionMode === 'audio' ? 'Click to enable this laptop’s sound' : 'Video is playing · Click to enable this laptop’s sound';
          playBlocked.classList.add('show');
          lastError = '';
        } catch {
          lastError = 'Click once on this laptop to allow playback.';
          playBlocked.classList.add('show');
        }
      } else if (error.name !== 'AbortError') {
        lastError = error.message || 'This laptop could not start the video.';
      }
    }
  })();
  try { await playbackAttempt; } finally { playbackAttempt = null; }
}

async function execute(commandState) {
  if (currentState && (commandState.serverId !== currentState.serverId || commandState.commandId < currentState.commandId)) return;
  applyStateAppearance(commandState);
  commandState = currentState;
  updateController();
  if (!ready) return;
  if (commandState.type === 'identify') {
    $('#identify').textContent = screenNumber;
    $('#identify').classList.add('show');
    setTimeout(() => $('#identify').classList.remove('show'), 2400);
    return;
  }
  if (sessionMode === 'presentation' || ['mode', 'screen-audio', 'mute-all', 'layout', 'session-mode', 'youtube-audio-mode', 'loop'].includes(commandState.type)) return;

  const isYouTube = sessionMode === 'youtube';
  if (isYouTube && youtubePlayer && youtubeReady) {
    const target = targetPosition(commandState);
    youtubePlayer.seek(target, true);
    youtubeLastSeek = performance.now();
    if (commandState.playing) {
      try {
        youtubePlayer.play();
        verifyYouTubePlayback(commandState.asset?.videoId || youtubeVideoId);
        playBlocked.classList.remove('show');
      } catch {
        lastError = 'Playback needs one click on this laptop.';
        playBlocked.classList.add('show');
        postStatus();
      }
    } else {
      clearTimeout(youtubeStartCheckTimer);
      youtubePlayer.pause();
    }
    return;
  }

  if (!Number.isFinite(video.duration)) return;
  seekTo(targetPosition(commandState));
  if (commandState.playing) {
    await playLocalMedia();
  } else {
    video.pause();
  }
}

function schedule(commandState) {
  const delay = Math.max(0, commandState.executeAt - serverNow());
  setTimeout(() => execute(commandState), delay);
}

function applyWhenReady(nextState) {
  const delay = Math.max(0, Number(nextState?.notBefore || 0) - serverNow());
  if (delay > 10) setTimeout(() => applyStateAppearance(nextState), delay);
  else applyStateAppearance(nextState);
}

function correctDrift(playbackState) {
  if (currentState && playbackState.serverId === currentState.serverId && playbackState.commandId < currentState.commandId) return;
  if (Number(playbackState?.notBefore) > serverNow()) return;
  applyStateAppearance(playbackState);
  playbackState = currentState;
  if (!ready || sessionMode === 'presentation') return;

  const isYouTube = sessionMode === 'youtube';
  if (isYouTube && youtubePlayer && youtubeReady) {
    const target = targetPosition(playbackState);
    const current = youtubePlayer.getCurrentTime();
    const state = youtubePlayer.getState();

    if (!playbackState.playing) {
      if (state === 1) youtubePlayer.pause();
      if (Math.abs(target - current) > 0.5 && performance.now() - youtubeLastSeek > 1200) {
        youtubePlayer.seek(target, true);
        youtubeLastSeek = performance.now();
      }
    } else {
      if (state !== 1 && state !== 3 && !playBlocked.classList.contains('show')) {
        youtubePlayer.play();
        verifyYouTubePlayback(playbackState.asset?.videoId || youtubeVideoId);
      }
      const drift = target - current;
      if (state === 1 && Math.abs(drift) > 0.75 && performance.now() - youtubeLastSeek > 2500) {
        youtubePlayer.seek(target, true);
        youtubeLastSeek = performance.now();
      }
    }
    return;
  }

  if (!Number.isFinite(video.duration)) return;
  const target = targetPosition(playbackState);
  const drift = target - video.currentTime;
  if (!playbackState.playing) {
    video.pause();
    video.playbackRate = 1;
    if (Math.abs(drift) > 0.08) seekTo(target);
    return;
  }
  if (video.paused && !video.ended) playLocalMedia();
  if (Math.abs(drift) > 0.22) {
    seekTo(target);
    video.playbackRate = 1;
  } else if (Math.abs(drift) > 0.045) {
    video.playbackRate = drift > 0 ? 1.025 : 0.975;
  } else {
    video.playbackRate = 1;
  }
}

function showControls() {
  if (screenNumber !== 1 || !ready) return;
  screenControls.classList.add('visible');
  $('#screenHud').classList.remove('fade');
  clearTimeout(controlsTimer);
  controlsTimer = setTimeout(() => {
    screenControls.classList.remove('visible');
    $('#screenHud').classList.add('fade');
  }, 3600);
}

function updateController() {
  const isYouTube = sessionMode === 'youtube';
  let duration = 0;
  let position = 0;

  if (isYouTube && youtubePlayer && youtubeReady) {
    duration = youtubePlayer.getDuration();
    position = youtubePlayer.getCurrentTime();
  } else {
    duration = Number.isFinite(video.duration) ? video.duration : 0;
    position = Number.isFinite(video.currentTime) ? video.currentTime : targetPosition(currentState);
  }

  if (!scrubbing) screenTimeline.value = position;
  screenTimeline.max = duration || 100;
  if (!scrubbing) $('#screenCurrentTime').textContent = formatTime(position);
  $('#screenDuration').textContent = duration ? formatTime(duration) : '--:--';
  $('#screenPlay').innerHTML = `<span class="fi">${currentState?.playing ? '&#xE769;' : '&#xE768;'}</span>`;
  $('#screenPage').textContent = currentState?.page || 1;
  $('#screenPageTotal').textContent = `/ ${currentState?.asset?.pageCount || '--'}`;
  $('#screenPreviousPage').disabled = !currentState?.asset || currentState.page <= 1;
  $('#screenNextPage').disabled = !currentState?.asset || (currentState.asset.pageCount && currentState.page >= currentState.asset.pageCount);
}

function togglePlayback() {
  if (!currentState?.asset || sessionMode === 'presentation') return;
  const currentPosition = sessionMode === 'youtube' && youtubeReady ? youtubePlayer.getCurrentTime() : video.currentTime;
  command(currentState.playing ? { type: 'pause' } : { type: 'play', position: currentPosition || targetPosition(currentState) });
}

function seekRelative(seconds) {
  if (!currentState?.asset || sessionMode === 'presentation') return;
  const playbackDuration = sessionMode === 'youtube' && youtubeReady ? youtubePlayer.getDuration() : video.duration;
  const next = Math.max(0, Math.min(playbackDuration || Infinity, targetPosition(currentState) + seconds));
  showGestureFeedback(seconds);
  command({ type: 'seek', position: next });
}

function showGestureFeedback(seconds) {
  const feedback = $('#screenGestureFeedback');
  feedback.textContent = seconds < 0 ? '−10 seconds' : '+10 seconds';
  feedback.className = `gesture-feedback show ${seconds < 0 ? 'left' : 'right'}`;
  setTimeout(() => { feedback.className = 'gesture-feedback'; }, 650);
}

async function syncClock() {
  const samples = [];
  for (let index = 0; index < 4; index += 1) {
    const start = Date.now();
    try {
      const response = await fetch(`/api/time?t=${start}`, { cache: 'no-store' });
      const { serverTime } = await response.json();
      const end = Date.now();
      samples.push({ rtt: end - start, offset: serverTime - (start + end) / 2 });
    } catch {}
  }
  samples.sort((a, b) => a.rtt - b.rtt);
  if (samples.length) serverOffset = samples[0].offset;
}

function mediaIsReady() {
  if (!currentState?.asset) return false;
  if (sessionMode === 'presentation') return documentReady;
  if (sessionMode === 'youtube') return youtubeReady && !youtubePlayer?.lastError;
  return Boolean(currentAssetVersion && Number.isFinite(video.duration) && video.readyState >= 1);
}

async function postStatus() {
  if (!screenNumber) return;
  const isYouTube = sessionMode === 'youtube';
  let videoDuration = 0;
  let playbackTime = 0;

  if (isYouTube && youtubePlayer && youtubeReady) {
    videoDuration = youtubePlayer.getDuration();
    playbackTime = youtubePlayer.getCurrentTime();
  } else {
    videoDuration = Number.isFinite(video.duration) ? video.duration : 0;
    playbackTime = video.currentTime || 0;
  }

  try {
    const response = await fetch('/api/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId, screen: screenNumber, build: CLIENT_BUILD, ready, mediaReady: mediaIsReady(),
        fileName: isYouTube ? (youtubePlayer?.getVideoData()?.title || currentState?.asset?.name || '') : (currentState?.asset?.name || ''), fileSize: currentState?.asset?.size || 0,
        duration: videoDuration,
        playbackTime: playbackTime, page: currentState?.page || 0,
        paused: isYouTube ? youtubePlayer?.getState() !== 1 : video.paused,
        playerState: isYouTube ? youtubePlayer?.getState() : null,
        buffering: isYouTube ? youtubePlayer?.getState() === 3 : video.readyState < 3,
        autoplayMuted: localAutoplayMuted,
        error: lastError,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error('Status request failed');
    markConnectionLive();
    if (!currentState) serverOffset = data.state.serverTime - Date.now();
    const stateChanged = !currentState || data.state.commandId !== currentState.commandId || data.state.asset?.version !== currentState.asset?.version;
    if (!currentState && requestedScreen && requestedScreen <= data.state.screenCount) {
      ready = true;
      setup.classList.add('hidden');
    }
    if (ready && sessionMode !== 'presentation') correctDrift(data.state);
    else if (stateChanged) applyWhenReady(data.state);
  } catch {
    markConnectionReconnecting();
  }
}

// State is also fetched without SSE: some hotspots/proxies buffer event streams.
async function fetchInitialState() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error('Server unavailable');
    const data = await response.json();
    if (!currentState) serverOffset = data.state.serverTime - Date.now();
    if (requestedScreen && requestedScreen <= data.state.screenCount) {
      ready = true;
      setup.classList.add('hidden');
    }
    applyWhenReady(data.state);
    if (ready) correctDrift(data.state);
    markConnectionLive();
    postStatus();
  } catch { markConnectionReconnecting(); }
}

renderScreenChoices();
if (screenNumber) selectScreen(screenNumber);

picker.addEventListener('click', (event) => {
  const button = event.target.closest('[data-screen]');
  if (button) selectScreen(button.dataset.screen);
});

readyButton.addEventListener('click', async () => {
  ready = true;
  lastError = '';
  setup.classList.add('hidden');
  waitingAsset.classList.toggle('show', !currentState?.asset);
  applyAudioSettings();
  if (sessionMode === 'youtube' && youtubePlayer && youtubeReady) {
    const target = targetPosition(currentState);
    youtubePlayer.seek(target, true);
    if (currentState?.playing) youtubePlayer.play();
    else {
      youtubePlayer.play();
      setTimeout(() => {
        youtubePlayer.pause();
        youtubePlayer.seek(target, true);
      }, 120);
    }
  } else if (sessionMode === 'youtube' && currentState?.asset?.videoId) {
    youtubeRetryCount = 0;
    clearTimeout(youtubeRetryTimer);
    initYouTubePlayer(currentState.asset.videoId, true);
  } else if (sessionMode !== 'presentation' && Number.isFinite(video.duration)) {
    try {
      localAutoplayMuted = false;
      video.muted = Boolean(audioSetting().muted);
      seekTo(targetPosition(currentState));
      await video.play();
      if (!currentState?.playing) video.pause();
    } catch {}
  }
  try { await document.documentElement.requestFullscreen(); } catch {}
  if (currentState) correctDrift(currentState);
  postStatus();
  updateLabels();
  showControls();
});

playBlocked.addEventListener('click', async () => {
  try {
    if (sessionMode === 'youtube' && youtubePlayer && youtubeReady) youtubePlayer.play();
    else {
      localAutoplayMuted = false;
      video.muted = Boolean(audioSetting().muted);
      await video.play();
      if (!currentState?.playing) video.pause();
    }
    playBlocked.classList.remove('show');
    lastError = '';
    postStatus();
  } catch {
    lastError = 'Playback is still blocked by the browser.';
  }
});

video.addEventListener('loadedmetadata', () => {
  clearTimeout(mediaLoadTimer);
  $('#localPeerFileChoice').hidden = true;
  lastError = '';
  waitingAsset.classList.remove('show');
  postStatus();
  if (currentState) correctDrift(currentState);
  updateController();
});
video.addEventListener('canplay', postStatus);
video.addEventListener('playing', () => {
  lastError = '';
  waitingAsset.classList.remove('show');
  postStatus();
});
video.addEventListener('ended', () => {
  if (screenNumber === 1 && currentState?.playing && sessionMode !== 'youtube') command(currentState.loop ? { type: 'play', position: 0 } : { type: 'pause' });
  postStatus();
});
video.addEventListener('timeupdate', updateController);
$('#localPeerFile').addEventListener('change', async () => {
  const file = $('#localPeerFile').files[0];
  if (!file || currentState?.asset?.source !== 'peer' || !filePeer) return;
  const asset = currentState.asset;
  try { const url = await filePeer.selectSameFile(file, asset); if (currentState?.asset?.version !== asset.version) return; video.src = url; currentAssetVersion = asset.version; lastError = ''; video.load(); }
  catch (error) { lastError = error.message; $('#waitingCopy').textContent = error.message; postStatus(); }
});
window.addEventListener('cinewall-peer-error', (event) => {
  if (currentState?.asset?.source !== 'peer') return;
  lastError = event.detail; $('#waitingCopy').textContent = event.detail; $('#localPeerFileChoice').hidden = false; waitingAsset.classList.add('show'); postStatus();
});
video.addEventListener('error', () => {
  if (!currentAssetVersion) return;
  const code = video.error?.code;
  if (currentState?.asset?.source === 'peer') $('#localPeerFileChoice').hidden = false;
  lastError = code === 2 ? 'Video transfer failed. Reconnecting to the admin laptop…' : code === 3 || code === 4 ? 'This laptop cannot decode this video. Use an H.264/AAC MP4 file.' : 'Video playback was interrupted.';
  if (code === 2 && mediaLoadAttempts < 5 && currentState?.asset) setTimeout(() => loadMedia(currentState.asset, true), 1500);
  $('#waitingTitle').textContent = 'Playback needs attention';
  $('#waitingCopy').textContent = lastError;
  waitingAsset.classList.add('show');
  postStatus();
});
documentFrame.addEventListener('load', () => {
  documentReady = true;
  waitingAsset.classList.remove('show');
  postStatus();
});
documentImage.addEventListener('load', () => {
  documentReady = true;
  waitingAsset.classList.remove('show');
  postStatus();
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (sessionMode === 'presentation' && currentState?.asset?.renderType === 'pdf') {
      documentKey = '';
      loadPresentation(currentState.asset, currentState.page || 1, currentState.mode || 'fit');
    }
    if (sessionMode === 'youtube') sizeYouTubeWall();
  }, 160);
});
window.addEventListener('online', () => {
  markConnectionReconnecting();
  postStatus();
  syncClock();
  if (sessionMode === 'youtube' && ready && !youtubeReady && currentState?.asset?.videoId) {
    youtubeRetryCount = 0;
    initYouTubePlayer(currentState.asset.videoId, true);
  }
});
window.addEventListener('offline', markConnectionReconnecting);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  postStatus();
  if (currentState && ready) correctDrift(currentState);
});

$('#screenPlay').addEventListener('click', togglePlayback);
$('#screenBack').addEventListener('click', () => seekRelative(-10));
$('#screenForward').addEventListener('click', () => seekRelative(10));
$('#screenFullscreen').addEventListener('click', () => document.documentElement.requestFullscreen().catch(() => {}));
$('#screenPreviousPage').addEventListener('click', () => command({ type: 'previous-page' }));
$('#screenNextPage').addEventListener('click', () => command({ type: 'next-page' }));
$('#screenPresentationFullscreen').addEventListener('click', () => document.documentElement.requestFullscreen().catch(() => {}));
$('#screenMute').addEventListener('click', () => command({ type: 'screen-audio', screen: screenNumber, muted: !audioSetting().muted }));
$('#screenVolume').addEventListener('input', () => {
  const value = Number($('#screenVolume').value);
  if (sessionMode === 'youtube' && youtubePlayer && youtubeReady) {
    youtubePlayer.setVolume(value);
  } else {
    video.volume = value;
  }
  $('#screenVolumeValue').textContent = `${Math.round(value * 100)}%`;
  clearTimeout(localVolumeTimer);
  localVolumeTimer = setTimeout(() => { localVolumeTimer = null; command({ type: 'screen-audio', screen: screenNumber, volume: value }); }, 35);
});
$('#screenVolume').addEventListener('change', () => { clearTimeout(localVolumeTimer); localVolumeTimer = null; command({ type: 'screen-audio', screen: screenNumber, volume: Number($('#screenVolume').value) }); });

screenTimeline.addEventListener('pointerdown', () => { scrubbing = true; });
screenTimeline.addEventListener('input', () => { scrubbing = true; $('#screenCurrentTime').textContent = formatTime(Number(screenTimeline.value)); });
screenTimeline.addEventListener('change', () => {
  command({ type: 'seek', position: Number(screenTimeline.value) });
  scrubbing = false;
});
screenTimeline.addEventListener('pointercancel', () => { scrubbing = false; });

$('#screenGesture').addEventListener('dblclick', (event) => {
  const bounds = event.currentTarget.getBoundingClientRect();
  seekRelative(event.clientX - bounds.left < bounds.width / 2 ? -10 : 10);
});

document.addEventListener('mousemove', showControls);
document.addEventListener('click', showControls);
document.addEventListener('keydown', (event) => {
  if (ready && event.key.toLowerCase() === 'f' && !event.target.matches('input, button, a')) {
    document.documentElement.requestFullscreen().catch(() => {});
    return;
  }
  if (screenNumber !== 1 || !ready || event.target.matches('input, button, a')) return;
  if (sessionMode === 'presentation') {
    if (event.code === 'ArrowLeft') { event.preventDefault(); command({ type: 'previous-page' }); }
    else if (event.code === 'ArrowRight') { event.preventDefault(); command({ type: 'next-page' }); }
  } else if (event.code === 'Space') {
    event.preventDefault(); togglePlayback();
  } else if (event.code === 'ArrowLeft') {
    event.preventDefault(); seekRelative(-10);
  } else if (event.code === 'ArrowRight') {
    event.preventDefault(); seekRelative(10);
  }
  showControls();
});
document.querySelector('.wall-viewport').addEventListener('dblclick', () => {
  if (ready && screenNumber !== 1) document.documentElement.requestFullscreen().catch(() => {});
});

const events = new EventSource('/events');
events.addEventListener('open', () => {
  markConnectionLive();
  syncClock();
});
events.addEventListener('error', () => {
  markConnectionReconnecting();
});
events.addEventListener('state', (event) => applyWhenReady(JSON.parse(event.data)));
events.addEventListener('command', (event) => schedule(JSON.parse(event.data)));
events.addEventListener('pulse', (event) => correctDrift(JSON.parse(event.data)));

setInterval(postStatus, 2000);
setInterval(() => { if (!screenNumber || !currentState) fetchInitialState(); }, 3000);
setInterval(syncClock, 30000);
setInterval(updateController, 250);
syncClock();
fetchInitialState();
