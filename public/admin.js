'use strict';

const $ = (selector) => document.querySelector(selector);
const screenGrid = $('#screenGrid');
const screenLinks = $('#screenLinks');
const timeline = $('#timeline');
const currentTimeLabel = $('#currentTime');
const durationLabel = $('#duration');
const warning = $('#fileWarning');
const connection = $('#connection');
const preview = $('#adminPreview');
let status = { screens: [], state: { position: 0, playing: false, mode: 'crop', screenCount: 3, audioScreen: 2, movie: null } };
let duration = 0;
let scrubbing = false;
let serverOffset = 0;
let uploadBusy = false;
let connectionInfo = null;
let previewVersion = '';

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

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function screenName(number, count = status.state.screenCount || 3) {
  if (count === 2) return number === 1 ? 'Left · Admin' : 'Right';
  return ['', 'Left · Admin', 'Centre', 'Right'][number];
}

function logicalScreens() {
  const count = status.state.screenCount || 3;
  return Array.from({ length: count }, (_, index) => index + 1).map((number) => {
    const matches = status.screens.filter((screen) => screen.screen === number);
    return matches.sort((a, b) => b.lastSeen - a.lastSeen)[0] || { screen: number, ready: false, mediaReady: false };
  });
}

function positionNow() {
  const state = status.state;
  if (!state.playing) return state.position || 0;
  return (state.position || 0) + Math.max(0, Date.now() + serverOffset - state.anchorTime) / 1000;
}

function readyScreens() {
  return logicalScreens().filter((screen) => screen.ready && screen.mediaReady);
}

function renderMetrics() {
  const count = status.state.screenCount || 3;
  const ready = readyScreens().length;
  $('#layoutMetric').textContent = `${count} screens`;
  $('#readyMetric').textContent = `${ready} / ${count}`;
  $('#readySegments').innerHTML = Array.from({ length: count }, (_, index) => `<span class="${index < ready ? 'ready' : ''}"></span>`).join('');
  $('#playbackMetric').textContent = status.state.playing ? 'Playing' : status.state.movie ? 'Paused' : 'Idle';
  $('#playbackSub').textContent = status.state.movie ? formatTime(positionNow()) : 'Waiting for a movie';
  $('#movieMetric').textContent = status.state.movie?.name || 'No movie selected';
  $('#movieSizeMetric').textContent = status.state.movie ? formatBytes(status.state.movie.size) : 'Choose a file from this admin laptop';
}

function renderScreens() {
  const screens = logicalScreens();
  screenGrid.style.gridTemplateColumns = `repeat(${screens.length}, 1fr)`;
  const ready = screens.filter((screen) => screen.ready && screen.mediaReady).length;
  $('#readyCount').textContent = `${ready}/${screens.length} ready`;
  screenGrid.innerHTML = screens.map((screen) => {
    const fullyReady = screen.ready && screen.mediaReady;
    const stateLabel = !screen.ready ? 'Not joined' : !status.state.movie ? 'Waiting for movie' : !screen.mediaReady ? 'Loading movie' : 'Ready';
    const detail = screen.error || status.state.movie?.name || (screen.screen === 1 ? 'Open this screen on the admin laptop' : 'Open the assigned link on this laptop');
    return `
      <article class="display-tile ${fullyReady ? 'ready' : ''}">
        <div class="display-tile-head">
          <span class="display-number">${screen.screen}</span>
          <span class="display-state"><span class="status-dot"></span>${stateLabel}</span>
        </div>
        <h3>${screenName(screen.screen, screens.length)}</h3>
        <p title="${escapeHtml(detail)}">${escapeHtml(detail)}</p>
        <div class="display-time">${fullyReady ? formatTime(screen.playbackTime) : '—'}</div>
      </article>`;
  }).join('');

  const loaded = screens.filter((screen) => screen.ready && screen.mediaReady);
  const durations = loaded.map((screen) => screen.duration).filter(Boolean);
  duration = durations.length ? Math.min(...durations) : (Number.isFinite(preview.duration) ? preview.duration : 0);
  timeline.max = duration || 100;
  durationLabel.textContent = duration ? formatTime(duration) : '--:--';
  const errors = screens.map((screen) => screen.error).filter(Boolean);
  warning.classList.toggle('show', Boolean(errors.length));
  warning.textContent = errors[0] || '';
  renderMetrics();
}

function renderLinks() {
  if (!connectionInfo) return;
  const count = status.state.screenCount || 3;
  const remoteAddress = connectionInfo.networks?.find((item) => !item.isHotspot)?.address || connectionInfo.addresses?.[0] || location.hostname;
  const origin = `${location.protocol}//${remoteAddress}:${connectionInfo.port}`;
  const links = [
    { number: 1, name: 'Admin screen', note: 'This laptop · Left', url: `${location.protocol}//localhost:${connectionInfo.port}/screen.html?screen=1`, local: true },
    { number: 2, name: 'Screen 2', note: count === 2 ? 'Second laptop · Right' : 'Second laptop · Centre', url: `${origin}/screen.html?screen=2` },
    { number: 3, name: 'Screen 3', note: 'Third laptop · Right', url: `${origin}/screen.html?screen=3` },
  ];
  screenLinks.innerHTML = links.map((item) => {
    const inactive = item.number > count;
    return `
      <article class="screen-link-card ${inactive ? 'inactive' : ''}">
        <div class="link-card-head">
          <div class="screen-role"><span class="screen-role-icon fi">&#xE7F4;</span><span><strong>${item.name}</strong><small>${inactive ? 'Enable 3-screen mode first' : item.note}</small></span></div>
          <span class="display-number">${item.number}</span>
        </div>
        <code title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</code>
        <div class="link-actions">
          ${inactive ? '<button disabled>Inactive</button>' : `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener"><span class="fi">&#xE8A7;</span>${item.local ? 'Open here' : 'Open link'}</a>`}
          <button data-copy-link="${escapeHtml(item.url)}" ${inactive ? 'disabled' : ''} title="Copy link" aria-label="Copy Screen ${item.number} link"><span class="fi">&#xE8C8;</span></button>
        </div>
      </article>`;
  }).join('');

  const hotspot = connectionInfo.networks?.find((item) => item.isHotspot);
  $('#alternateLinks').textContent = hotspot
    ? `Using the admin laptop’s Mobile Hotspot? Replace ${remoteAddress} with ${hotspot.address} in Screen 2 and Screen 3 links.`
    : '';
}

function loadPreview(movie) {
  if (!movie) {
    previewVersion = '';
    preview.pause();
    preview.removeAttribute('src');
    preview.load();
    $('#previewEmpty').hidden = false;
    return;
  }
  if (previewVersion === movie.version) return;
  previewVersion = movie.version;
  preview.src = `/api/movie/stream?v=${encodeURIComponent(movie.version)}&preview=1`;
  preview.load();
}

function syncPreview() {
  const state = status.state;
  loadPreview(state.movie);
  if (!state.movie || !Number.isFinite(preview.duration)) return;
  const target = Math.min(positionNow(), Math.max(0, preview.duration - .04));
  if (Math.abs(preview.currentTime - target) > .35) preview.currentTime = target;
  if (state.playing && preview.paused) preview.play().catch(() => {});
  if (!state.playing && !preview.paused) preview.pause();
}

function renderState() {
  const state = status.state;
  const count = state.screenCount || 3;
  document.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('active', button.dataset.mode === state.mode));
  document.querySelectorAll('[data-layout]').forEach((button) => button.classList.toggle('active', Number(button.dataset.layout) === count));
  const audioOptions = count === 2
    ? [{ value: '0', label: 'Muted' }, { value: '1', label: 'Admin' }, { value: '2', label: 'Right' }, { value: 'all', label: 'All' }]
    : [{ value: '0', label: 'Muted' }, { value: '1', label: 'Admin' }, { value: '2', label: 'Centre' }, { value: '3', label: 'Right' }, { value: 'all', label: 'All' }];
  $('#audioControls').innerHTML = audioOptions.map((option) => `<button data-audio="${option.value}" class="${String(state.audioScreen) === option.value ? 'active' : ''}">${option.label}</button>`).join('');

  const screens = logicalScreens();
  const allReady = screens.length === count && screens.every((screen) => screen.ready && screen.mediaReady);
  $('#movieTitle').textContent = state.movie?.name || 'Choose your movie';
  $('#movieStatus').textContent = uploadBusy
    ? 'Copying the movie into the cinema server…'
    : state.movie
      ? `${formatBytes(state.movie.size)} · Streaming locally to every joined display`
      : 'The movie is selected once here and streamed to every screen.';
  $('#adminFileLabel').textContent = state.movie ? 'Change movie' : 'Choose movie';
  $('#trackTitle').textContent = state.movie?.name || 'No movie loaded';
  $('#playerState').textContent = state.playing ? 'PLAYING' : state.movie ? 'PAUSED' : 'IDLE';
  $('#play').hidden = Boolean(state.playing);
  $('#pause').hidden = !state.playing;
  $('#play').disabled = !state.movie || !allReady || uploadBusy;
  $('#pause').disabled = !state.playing;
  $('#restart').disabled = !state.movie;
  $('#back').disabled = !state.movie;
  $('#forward').disabled = !state.movie;
  timeline.disabled = !state.movie;
  renderMetrics();
  renderLinks();
  syncPreview();
}

async function refresh() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    status = await response.json();
    serverOffset = status.state.serverTime - Date.now();
    connection.classList.add('online');
    connection.lastElementChild.textContent = 'Live sync';
    renderScreens();
    renderState();
  } catch {
    connection.classList.remove('online');
    connection.lastElementChild.textContent = 'Reconnecting';
  }
}

async function command(payload) {
  const response = await fetch('/api/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('Command failed');
  const result = await response.json();
  status.state = result.command;
  renderScreens();
  renderState();
}

function openScreenOne() {
  window.open('/screen.html?screen=1', 'cinewall-screen-1');
}

$('#play').addEventListener('click', () => command({ type: 'play', position: Number(timeline.value) }));
$('#pause').addEventListener('click', () => command({ type: 'pause' }));
$('#restart').addEventListener('click', () => command({ type: 'restart' }));
$('#back').addEventListener('click', () => command({ type: 'seek', position: Math.max(0, positionNow() - 10) }));
$('#forward').addEventListener('click', () => command({ type: 'seek', position: Math.min(duration || Infinity, positionNow() + 10) }));
$('#identify').addEventListener('click', () => command({ type: 'identify' }));
$('#openAdminScreen').addEventListener('click', openScreenOne);
$('#openScreenControl').addEventListener('click', openScreenOne);

$('#modeControls').addEventListener('click', (event) => {
  const button = event.target.closest('[data-mode]');
  if (button) command({ type: 'mode', mode: button.dataset.mode });
});
$('#layoutControls').addEventListener('click', (event) => {
  const button = event.target.closest('[data-layout]');
  if (button) command({ type: 'layout', screenCount: Number(button.dataset.layout) });
});
$('#audioControls').addEventListener('click', (event) => {
  const button = event.target.closest('[data-audio]');
  if (button) command({ type: 'audio', screen: button.dataset.audio === 'all' ? 'all' : Number(button.dataset.audio) });
});

timeline.addEventListener('pointerdown', () => { scrubbing = true; });
timeline.addEventListener('input', () => { currentTimeLabel.textContent = formatTime(Number(timeline.value)); });
timeline.addEventListener('change', () => {
  command({ type: 'seek', position: Number(timeline.value) });
  scrubbing = false;
});
window.addEventListener('pointerup', () => { scrubbing = false; });

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
  setTimeout(() => { button.innerHTML = '<span class="fi">&#xE8C8;</span>'; }, 1400);
}

screenLinks.addEventListener('click', (event) => {
  const button = event.target.closest('[data-copy-link]');
  if (button && !button.disabled) copyText(button.dataset.copyLink, button);
});

$('#adminMovieFile').addEventListener('change', () => {
  const file = $('#adminMovieFile').files[0];
  if (!file) return;
  uploadBusy = true;
  $('#uploadProgressWrap').hidden = false;
  $('#uploadProgressBar').style.width = '0%';
  $('#uploadProgressText').textContent = '0%';
  renderState();

  const request = new XMLHttpRequest();
  request.open('POST', `/api/movie?name=${encodeURIComponent(file.name)}`);
  request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
  request.upload.addEventListener('progress', (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
    $('#uploadProgressBar').style.width = `${percent}%`;
    $('#uploadProgressText').textContent = `${percent}%`;
  });
  request.addEventListener('load', () => {
    uploadBusy = false;
    if (request.status >= 200 && request.status < 300) {
      const result = JSON.parse(request.responseText);
      status.state = result.state;
      $('#uploadProgressBar').style.width = '100%';
      $('#uploadProgressText').textContent = 'Ready';
      setTimeout(() => { $('#uploadProgressWrap').hidden = true; }, 1800);
    } else {
      let message = 'The movie could not be prepared.';
      try { message = JSON.parse(request.responseText).error || message; } catch {}
      warning.textContent = message;
      warning.classList.add('show');
    }
    renderScreens();
    renderState();
  });
  request.addEventListener('error', () => {
    uploadBusy = false;
    warning.textContent = 'The movie transfer failed. Keep the cinema server open and try again.';
    warning.classList.add('show');
    renderState();
  });
  request.send(file);
});

preview.addEventListener('loadedmetadata', () => {
  $('#previewEmpty').hidden = true;
  duration = preview.duration;
  timeline.max = duration;
  durationLabel.textContent = formatTime(duration);
  syncPreview();
});

const savedTheme = localStorage.getItem('cinewall-theme');
if (savedTheme) document.body.dataset.theme = savedTheme;
$('#themeToggle').addEventListener('click', () => {
  const next = document.body.dataset.theme === 'light' ? 'dark' : 'light';
  document.body.dataset.theme = next;
  localStorage.setItem('cinewall-theme', next);
});

document.addEventListener('keydown', (event) => {
  if (event.target.matches('input, button, a')) return;
  if (event.code === 'Space' && status.state.movie) {
    event.preventDefault();
    command(status.state.playing ? { type: 'pause' } : { type: 'play', position: positionNow() });
  } else if (event.code === 'ArrowLeft' && status.state.movie) {
    event.preventDefault();
    command({ type: 'seek', position: Math.max(0, positionNow() - 10) });
  } else if (event.code === 'ArrowRight' && status.state.movie) {
    event.preventDefault();
    command({ type: 'seek', position: Math.min(duration || Infinity, positionNow() + 10) });
  }
});

async function loadInfo() {
  connectionInfo = await (await fetch('/api/info')).json();
  renderLinks();
}

const events = new EventSource('/events');
events.addEventListener('state', (event) => {
  status.state = JSON.parse(event.data);
  renderScreens();
  renderState();
});
events.addEventListener('screens', (event) => {
  status.screens = JSON.parse(event.data).screens;
  renderScreens();
  renderState();
});
events.addEventListener('pulse', (event) => {
  status.state = JSON.parse(event.data);
  syncPreview();
});

setInterval(() => {
  if (!scrubbing) {
    const position = Math.min(duration || Infinity, positionNow());
    timeline.value = Number.isFinite(position) ? position : 0;
    currentTimeLabel.textContent = formatTime(position);
  }
  syncPreview();
  renderMetrics();
}, 300);
setInterval(refresh, 2500);
refresh();
loadInfo();

