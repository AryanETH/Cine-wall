'use strict';

const $ = (selector) => document.querySelector(selector);
const video = $('#video');
const stage = $('#wallStage');
const setup = $('#setup');
const picker = $('#screenPicker');
const readyButton = $('#readyButton');
const screenLabel = $('#screenLabel');
const networkLabel = $('#networkLabel');
const identify = $('#identify');
const connectionLost = $('#connectionLost');
const playBlocked = $('#playBlocked');
const waitingMovie = $('#waitingMovie');
const screenControls = $('#screenControls');
const screenTimeline = $('#screenTimeline');

const requestedScreen = Number(new URLSearchParams(location.search).get('screen'));
let screenNumber = [1, 2, 3].includes(requestedScreen) ? requestedScreen : Number(localStorage.getItem('cinema-screen')) || 0;
let wallScreens = 3;
let ready = false;
let serverOffset = 0;
let currentState = null;
let currentMovieVersion = '';
let movieLoadAttempts = 0;
let movieLoadTimer = null;
let controlsTimer = null;
let lastError = '';
let scrubbing = false;
const generatedId = globalThis.crypto?.randomUUID?.() || `screen-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clientId = sessionStorage.getItem('cinema-client-id') || generatedId;
sessionStorage.setItem('cinema-client-id', clientId);

function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return '--:--';
  const total = Math.floor(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function screenName(number) {
  if (wallScreens === 2) return number === 1 ? 'Left · Admin' : 'Right';
  return ['', 'Left · Admin', 'Centre', 'Right'][number];
}

function renderScreenChoices() {
  picker.style.gridTemplateColumns = `repeat(${wallScreens}, 1fr)`;
  picker.innerHTML = Array.from({ length: wallScreens }, (_, index) => {
    const number = index + 1;
    return `<button class="screen-choice ${number === screenNumber ? 'selected' : ''}" data-screen="${number}"><strong>${number}</strong>${screenName(number)}</button>`;
  }).join('');
}

function setLayout(count) {
  const nextCount = [2, 3].includes(Number(count)) ? Number(count) : 3;
  wallScreens = nextCount;
  stage.style.setProperty('--wall-screens', wallScreens);
  if (screenNumber > wallScreens) {
    screenNumber = 0;
    ready = false;
    video.pause();
    localStorage.removeItem('cinema-screen');
    setup.classList.remove('hidden');
  }
  renderScreenChoices();
  if (screenNumber) selectScreen(screenNumber);
  updateReadyButton();
}

function selectScreen(value) {
  screenNumber = Number(value);
  localStorage.setItem('cinema-screen', String(screenNumber));
  document.querySelectorAll('[data-screen]').forEach((button) => button.classList.toggle('selected', Number(button.dataset.screen) === screenNumber));
  stage.style.setProperty('--screen-index', screenNumber - 1);
  screenLabel.textContent = `Screen ${screenNumber} · ${screenName(screenNumber)}`;
  screenControls.classList.toggle('available', screenNumber === 1);
  updateReadyButton();
}

function updateReadyButton() {
  readyButton.disabled = !screenNumber || screenNumber > wallScreens;
}

function setMode(mode) {
  stage.classList.remove('mode-fit', 'mode-crop', 'mode-stretch');
  stage.classList.add(`mode-${mode}`);
}

function setAudio(screen) {
  video.muted = screen !== 'all' && Number(screen) !== screenNumber;
  video.volume = 1;
}

function loadMovie(movie, force = false) {
  if (!movie) {
    if (!currentMovieVersion && !video.getAttribute('src')) return;
    currentMovieVersion = '';
    clearTimeout(movieLoadTimer);
    video.pause();
    video.removeAttribute('src');
    video.load();
    waitingMovie.classList.toggle('show', ready);
    return;
  }
  if (movie.version === currentMovieVersion && !force) return;
  if (movie.version !== currentMovieVersion) movieLoadAttempts = 0;
  currentMovieVersion = movie.version;
  movieLoadAttempts += 1;
  lastError = '';
  waitingMovie.classList.remove('show');
  video.pause();
  video.src = `/api/movie/stream?v=${encodeURIComponent(movie.version)}&screen=${screenNumber}&attempt=${movieLoadAttempts}`;
  video.load();
  postStatus();
  clearTimeout(movieLoadTimer);
  movieLoadTimer = setTimeout(() => {
    if (currentMovieVersion === movie.version && !Number.isFinite(video.duration) && movieLoadAttempts < 5) loadMovie(movie, true);
  }, 6000);
}

function applyStateAppearance(state) {
  currentState = state;
  setLayout(state.screenCount);
  setMode(state.mode);
  setAudio(state.audioScreen);
  loadMovie(state.movie);
  waitingMovie.classList.toggle('show', ready && !state.movie);
  updateController();
}

function serverNow() {
  return Date.now() + serverOffset;
}

function targetPosition(state, at = serverNow()) {
  if (!state.playing) return state.position || 0;
  return Math.max(0, (state.position || 0) + Math.max(0, at - state.anchorTime) / 1000);
}

function seekTo(position) {
  if (!Number.isFinite(video.duration)) return;
  const safe = Math.min(Math.max(0, position), Math.max(0, video.duration - .04));
  if (Math.abs(video.currentTime - safe) > .025) video.currentTime = safe;
}

async function command(payload) {
  const response = await fetch('/api/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) return;
  const result = await response.json();
  applyStateAppearance(result.command);
}

async function execute(commandState) {
  applyStateAppearance(commandState);
  if (!ready) return;
  if (commandState.type === 'identify') {
    identify.textContent = screenNumber;
    identify.classList.add('show');
    setTimeout(() => identify.classList.remove('show'), 2400);
    return;
  }
  if (['mode', 'audio', 'layout'].includes(commandState.type) || !Number.isFinite(video.duration)) return;
  seekTo(targetPosition(commandState));
  if (commandState.playing) {
    try {
      await video.play();
      playBlocked.classList.remove('show');
    } catch {
      lastError = 'Playback needs one click on this screen.';
      playBlocked.classList.add('show');
      postStatus();
    }
  } else {
    video.pause();
  }
}

function schedule(commandState) {
  applyStateAppearance(commandState);
  const delay = Math.max(0, commandState.executeAt - serverNow());
  setTimeout(() => execute(commandState), delay);
}

function correctDrift(state) {
  applyStateAppearance(state);
  if (!ready || !Number.isFinite(video.duration)) return;
  const target = targetPosition(state);
  const drift = target - video.currentTime;
  if (!state.playing) {
    video.pause();
    video.playbackRate = 1;
    if (Math.abs(drift) > .08) seekTo(target);
    return;
  }
  if (video.paused) video.play().catch(() => playBlocked.classList.add('show'));
  if (Math.abs(drift) > .22) {
    seekTo(target);
    video.playbackRate = 1;
  } else if (Math.abs(drift) > .045) {
    video.playbackRate = drift > 0 ? 1.025 : .975;
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
  }, 3500);
}

function updateController() {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const position = Number.isFinite(video.currentTime) ? video.currentTime : targetPosition(currentState || {});
  if (!scrubbing) screenTimeline.value = position;
  screenTimeline.max = duration || 100;
  $('#screenCurrentTime').textContent = formatTime(position);
  $('#screenDuration').textContent = duration ? formatTime(duration) : '--:--';
  $('#screenPlay').innerHTML = `<span class="fi">${currentState?.playing ? '&#xE769;' : '&#xE768;'}</span>`;
}

function togglePlayback() {
  if (!currentState?.movie) return;
  command(currentState.playing ? { type: 'pause' } : { type: 'play', position: video.currentTime || targetPosition(currentState) });
}

async function syncClock() {
  const samples = [];
  for (let index = 0; index < 5; index += 1) {
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

async function postStatus() {
  if (!screenNumber) return;
  try {
    const response = await fetch('/api/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        screen: screenNumber,
        ready,
        mediaReady: Boolean(currentMovieVersion && Number.isFinite(video.duration) && video.readyState >= 1),
        fileName: currentState?.movie?.name || '',
        fileSize: currentState?.movie?.size || 0,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        playbackTime: video.currentTime || 0,
        paused: video.paused,
        error: lastError,
      }),
    });
    const data = await response.json();
    networkLabel.classList.add('online');
    networkLabel.lastChild.textContent = 'Live';
    if (!currentState || data.state.commandId !== currentState.commandId || data.state.movie?.version !== currentMovieVersion) applyStateAppearance(data.state);
  } catch {
    networkLabel.classList.remove('online');
    networkLabel.lastChild.textContent = 'Reconnecting';
  }
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
  waitingMovie.classList.toggle('show', !currentState?.movie);
  setAudio(currentState?.audioScreen ?? 2);
  if (Number.isFinite(video.duration)) {
    try {
      await video.play();
      video.pause();
      video.currentTime = targetPosition(currentState || {});
    } catch {}
  }
  try { await document.documentElement.requestFullscreen(); } catch {}
  if (currentState) correctDrift(currentState);
  postStatus();
  showControls();
});

playBlocked.addEventListener('click', async () => {
  try {
    await video.play();
    playBlocked.classList.remove('show');
    lastError = '';
    postStatus();
  } catch {
    lastError = 'Playback is still blocked by the browser.';
  }
});

video.addEventListener('loadedmetadata', () => {
  clearTimeout(movieLoadTimer);
  lastError = '';
  waitingMovie.classList.remove('show');
  postStatus();
  if (currentState) correctDrift(currentState);
  updateController();
});
video.addEventListener('canplay', postStatus);
video.addEventListener('timeupdate', updateController);
video.addEventListener('error', () => {
  if (!currentMovieVersion) return;
  lastError = 'This browser cannot stream the selected video format.';
  postStatus();
});

$('#screenPlay').addEventListener('click', togglePlayback);
$('#screenBack').addEventListener('click', () => currentState?.movie && command({ type: 'seek', position: Math.max(0, targetPosition(currentState) - 10) }));
$('#screenForward').addEventListener('click', () => currentState?.movie && command({ type: 'seek', position: Math.min(video.duration || Infinity, targetPosition(currentState) + 10) }));
$('#screenFullscreen').addEventListener('click', () => document.documentElement.requestFullscreen().catch(() => {}));
screenTimeline.addEventListener('pointerdown', () => { scrubbing = true; });
screenTimeline.addEventListener('input', () => { $('#screenCurrentTime').textContent = formatTime(Number(screenTimeline.value)); });
screenTimeline.addEventListener('change', () => {
  command({ type: 'seek', position: Number(screenTimeline.value) });
  scrubbing = false;
});

document.addEventListener('mousemove', showControls);
document.addEventListener('click', showControls);
document.addEventListener('keydown', (event) => {
  if (screenNumber !== 1 || !ready || event.target.matches('input, button, a')) return;
  if (event.code === 'Space') {
    event.preventDefault();
    togglePlayback();
  } else if (event.code === 'ArrowLeft' && currentState?.movie) {
    event.preventDefault();
    command({ type: 'seek', position: Math.max(0, targetPosition(currentState) - 10) });
  } else if (event.code === 'ArrowRight' && currentState?.movie) {
    event.preventDefault();
    command({ type: 'seek', position: Math.min(video.duration || Infinity, targetPosition(currentState) + 10) });
  } else if (event.key.toLowerCase() === 'f') {
    document.documentElement.requestFullscreen().catch(() => {});
  }
  showControls();
});

const events = new EventSource('/events');
events.addEventListener('open', () => {
  networkLabel.classList.add('online');
  networkLabel.lastChild.textContent = 'Live';
  connectionLost.classList.remove('show');
  syncClock();
});
events.addEventListener('error', () => {
  networkLabel.classList.remove('online');
  networkLabel.lastChild.textContent = 'Reconnecting';
  video.pause();
  connectionLost.classList.add('show');
});
events.addEventListener('state', (event) => applyStateAppearance(JSON.parse(event.data)));
events.addEventListener('command', (event) => schedule(JSON.parse(event.data)));
events.addEventListener('pulse', (event) => correctDrift(JSON.parse(event.data)));

setInterval(postStatus, 2000);
setInterval(syncClock, 30000);
setInterval(updateController, 250);
syncClock();

