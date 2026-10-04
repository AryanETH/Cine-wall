'use strict';

(() => {
  const el = (id) => document.getElementById(id);
  let inspection = null;
  let job = null;
  let polling = null;
  let checking = false;
  let preparing = false;
  let currentMode = '';
  const audioOnly = () => currentMode === 'audio';
  const availableFormats = () => (inspection?.formats || []).filter((option) => !audioOnly() || option.kind === 'audio');
  const formatName = (container) => container === 'm4a' ? 'M4A (AAC)' : container.toUpperCase();

  function message(text, error = false) {
    el('youtubeDownloadStatus').textContent = text;
    el('youtubeDownloadStatus').classList.toggle('error', error);
  }

  async function request(url, body) {
    const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'This request could not finish.');
    return data;
  }

  function selectedOption() { return availableFormats().find((option) => option.id === el('downloadQuality').value); }

  function renderFormats() {
    const selected = el('downloadContainer').value;
    const containers = [...new Set(availableFormats().map((option) => option.container))];
    el('downloadContainer').replaceChildren(...containers.map((container) => new Option(formatName(container), container)));
    if (containers.includes(selected)) el('downloadContainer').value = selected;
    el('downloadSelection').hidden = !containers.length;
    renderQualities();
    if (!containers.length) message('No audio formats are available for this video.', true);
  }

  function renderQualities() {
    const formats = availableFormats().filter((option) => option.container === el('downloadContainer').value);
    el('downloadQuality').replaceChildren(...formats.map((format) => new Option(format.label, format.id)));
    renderSize();
  }

  function renderSize() {
    const option = selectedOption();
    el('downloadSizeHint').textContent = option?.size ? `${(option.size / 1024 / 1024).toFixed(1)} MB` : '';
  }

  function renderJob() {
    const active = job && ['downloading', 'converting'].includes(job.state);
    preparing = Boolean(active);
    el('prepareYoutubeDownload').disabled = preparing;
    el('checkYoutubeFormats').disabled = preparing || checking;
    el('downloadContainer').disabled = preparing;
    el('downloadQuality').disabled = preparing;
    el('cancelYoutubeDownload').hidden = !active;
    el('youtubeDownloadProgress').hidden = !active;
    el('youtubeDownloadProgress').value = job?.progress || 0;
    el('saveYoutubeDownload').hidden = job?.state !== 'ready';
    const loadable = audioOnly() ? job?.kind === 'audio' && ['mp3', 'm4a', 'aac', 'wav'].includes(job.container) : currentMode === 'video' && job?.kind === 'video' && job.container === 'mp4';
    el('loadYoutubeDownload').hidden = !(job?.state === 'ready' && loadable);
    el('loadYoutubeDownload').textContent = audioOnly() ? 'Use in speaker room' : 'Use on video wall';
    if (!job) return;
    if (job.state === 'downloading') message(job.message || `Downloading · ${Math.round(job.progress)}%`);
    else if (job.state === 'converting') message(`Preparing ${job.container.toUpperCase()}…`);
    else if (job.state === 'ready') {
      el('saveYoutubeDownload').href = window.CineWallSession?.link(job.downloadUrl) || job.downloadUrl;
      el('saveYoutubeDownload').download = job.fileName;
      message('Ready');
    } else if (job.state === 'error') message(job.error || 'Download failed. Check the link and try again.', true);
    else if (job.state === 'cancelled') message(job.error || 'Download cancelled.');
  }

  async function poll() {
    clearTimeout(polling);
    if (!job || !['downloading', 'converting'].includes(job.state)) return;
    try {
      job = await request(`/api/youtube/downloads/${job.id}`);
      renderJob();
    } catch (error) { message(`${error.message} · retrying`, true); }
    if (['downloading', 'converting'].includes(job.state)) polling = setTimeout(poll, 1200);
    else sessionStorage.removeItem('cinewall-download-job');
  }

  function chooseSource(open) {
    el('youtubeDownloadPanel').hidden = !open;
    el('localVideoSource').classList.toggle('active', !open);
    el('localVideoSource').setAttribute('aria-pressed', String(!open));
    el('downloadYoutubeToggle').classList.toggle('active', open);
    el('downloadYoutubeToggle').setAttribute('aria-pressed', String(open));
    el('downloadYoutubeToggle').setAttribute('aria-expanded', String(open));
    el('fileSourceButton').hidden = open;
    el('dropZone').hidden = open;
    el('playlistButton').hidden = true;
    if (open) el('downloadYoutubeUrl').focus();
  }
  el('downloadYoutubeToggle').addEventListener('click', () => chooseSource(true));
  el('localVideoSource').addEventListener('click', () => chooseSource(false));

  function syncMode(mode) {
    if (mode === currentMode) return;
    currentMode = mode;
    el('localVideoSource').textContent = 'Local file';
    el('downloadPanelCopy').textContent = audioOnly() ? 'MP3 · AAC · M4A audio' : 'Video & audio downloads';
    el('youtubeDownloadPanel').setAttribute('aria-label', audioOnly() ? 'Download YouTube audio' : 'Download a YouTube video');
    el('downloadYoutubeUrl').placeholder = audioOnly() ? 'Drop or paste a YouTube link…' : 'https://youtube.com/watch?v=…';
    if (inspection) renderFormats();
    renderJob();
  }
  window.CineWallDownloadPanel = { syncMode, chooseSource };
  syncMode(document.body?.dataset.sessionMode || 'video');

  el('youtubeDownloadForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (checking || preparing) return;
    checking = true;
    el('checkYoutubeFormats').disabled = true;
    el('downloadSelection').hidden = true;
    job = null;
    renderJob();
    message('Checking available qualities…');
    try {
      const tools = await request('/api/youtube/tools');
      if (!tools.ready) throw new Error('Download tools are unavailable.');
      inspection = await request('/api/youtube/formats', { url: el('downloadYoutubeUrl').value.trim() });
      el('downloadVideoTitle').textContent = inspection.title;
      renderFormats();
      if (availableFormats().length) message('Choose a format and quality.');
    } catch (error) { message(error.message, true); }
    finally { checking = false; el('checkYoutubeFormats').disabled = false; }
  });

  el('downloadContainer').addEventListener('change', renderQualities);
  el('downloadQuality').addEventListener('change', renderSize);
  el('prepareYoutubeDownload').addEventListener('click', async () => {
    const option = selectedOption();
    if (!option || preparing) return;
    preparing = true;
    el('prepareYoutubeDownload').disabled = true;
    message('Starting download…');
    try {
      job = await request('/api/youtube/downloads', { inspectionId: inspection.id, optionId: option.id });
      sessionStorage.setItem('cinewall-download-job', job.id);
      renderJob();
      poll();
    } catch (error) { message(error.message, true); preparing = false; el('prepareYoutubeDownload').disabled = false; }
  });

  el('cancelYoutubeDownload').addEventListener('click', async () => {
    if (!job) return;
    try {
      job = await request(`/api/youtube/downloads/${job.id}/cancel`, {});
      clearTimeout(polling);
      sessionStorage.removeItem('cinewall-download-job');
      renderJob();
    } catch (error) { message(error.message, true); }
  });

  el('loadYoutubeDownload').addEventListener('click', async () => {
    if (!job || job.state !== 'ready' || el('loadYoutubeDownload').hidden) return;
    el('loadYoutubeDownload').disabled = true;
    const targetMode = currentMode;
    message(audioOnly() ? 'Loading this audio for every speaker…' : 'Preparing this video for every display…');
    try {
      await request(`/api/youtube/downloads/${job.id}/load`, {});
      message(targetMode === 'audio' ? 'Audio loaded' : 'Video loaded');
    } catch (error) { message(error.message, true); }
    finally { el('loadYoutubeDownload').disabled = false; }
  });

  const saved = sessionStorage.getItem('cinewall-download-job');
  if (/^[a-f0-9-]{36}$/.test(saved || '')) request(`/api/youtube/downloads/${saved}`).then((data) => { job = data; renderJob(); poll(); }).catch(() => sessionStorage.removeItem('cinewall-download-job'));
})();
