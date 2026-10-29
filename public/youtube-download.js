'use strict';

(() => {
  const el = (id) => document.getElementById(id);
  let inspection = null;
  let job = null;
  let polling = null;
  let checking = false;
  let preparing = false;
  let currentMode = '';
  let checkSequence = 0, checkController = null, pollSequence = 0, pollFailures = 0, pollPaused = false;
  const savedJob = {
    get() { try { return sessionStorage.getItem('cinewall-download-job'); } catch { return null; } },
    set(id) { try { sessionStorage.setItem('cinewall-download-job', id); } catch {} },
    clear() { try { sessionStorage.removeItem('cinewall-download-job'); } catch {} }
  };
  const audioOnly = () => currentMode === 'audio';
  const availableFormats = () => (inspection?.formats || []).filter((option) => !audioOnly() || option.kind === 'audio');
  const formatName = (container) => container === 'm4a' ? 'M4A (AAC)' : container.toUpperCase();

  function message(text, error = false) {
    el('youtubeDownloadStatus').textContent = text;
    el('youtubeDownloadStatus').classList.toggle('error', error);
  }

  async function request(url, body, { retry = false, signal, timeout = 20000 } = {}) {
    for (let attempt = 0; ; attempt++) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const abort = () => controller?.abort();
      if (signal?.aborted) throw Object.assign(Error('Check cancelled.'), { name: 'AbortError' });
      signal?.addEventListener('abort', abort, { once: true });
      let expired = false;
      const deadline = setTimeout(() => { expired = true; controller?.abort(); }, timeout);
      try {
        const response = await fetch(url, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' }),
          ...(controller ? { signal: controller.signal } : {}) });
        let data;
        try { data = await response.json(); }
        catch { throw Object.assign(Error('The download server is temporarily unavailable. Try again.'), { status: response.ok ? 502 : response.status || 502 }); }
        if (!response.ok) throw Object.assign(Error(data.error || 'This request could not finish.'), { status: response.status,
          retryAfter: Math.max(0, Math.min(60000, (Number(response.headers?.get?.('retry-after')) || 0) * 1000)) });
        if (!data || typeof data !== 'object') throw Object.assign(Error('The download server returned an incomplete response. Try again.'), { status: 502 });
        return data;
      } catch (error) {
        if (signal?.aborted) throw Object.assign(Error('Check cancelled.'), { name: 'AbortError' });
        if (expired) error = Error('The download server took too long to respond. Try again.');
        const temporary = !error.status || [502, 503, 504].includes(error.status);
        if (!retry || attempt >= 1 || !temporary) throw error;
        await new Promise(resolve => setTimeout(resolve, 600));
      } finally { clearTimeout(deadline); signal?.removeEventListener('abort', abort); }
    }
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
    el('checkYoutubeFormats').disabled = checking || preparing && !pollPaused;
    el('checkYoutubeFormats').textContent = pollPaused ? 'Reconnect' : 'Search';
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
    const id = job.id, ticket = ++pollSequence;
    let retryWait = 0;
    try {
      const next = await request(`/api/youtube/downloads/${id}`);
      if (ticket !== pollSequence || job?.id !== id) return;
      job = next; pollFailures = 0; pollPaused = false;
      renderJob();
    } catch (error) {
      if (ticket !== pollSequence || job?.id !== id) return;
      if (error.status && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) {
        job = { ...job, state: 'error', error: error.message }; savedJob.clear(); renderJob(); return;
      }
      pollFailures++;
      retryWait = error.retryAfter || (error.status === 429 ? 15000 : 0);
      if (pollFailures >= 5) {
        pollPaused = true; renderJob(); message('Connection lost. Reconnect to check your download.', true); return;
      }
      message('Reconnecting to your download…', true);
    }
    if (['downloading', 'converting'].includes(job.state)) polling = setTimeout(poll, Math.max(retryWait, Math.min(15000, 1200 * 2 ** pollFailures)));
    else savedJob.clear();
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
    if (pollPaused) { pollPaused = false; pollFailures = 0; renderJob(); await poll(); return; }
    if (checking || preparing) return;
    const ticket = ++checkSequence;
    checkController?.abort();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    checkController = controller;
    checking = true;
    el('checkYoutubeFormats').disabled = true;
    el('downloadSelection').hidden = true;
    job = null; inspection = null; pollPaused = false; pollSequence++; clearTimeout(polling);
    renderJob();
    message('Checking available qualities…');
    try {
      const tools = await request('/api/youtube/tools', null, { retry: true, signal: controller?.signal });
      if (!tools.ready) throw new Error(tools.message || 'Download tools are unavailable.');
      const next = await request('/api/youtube/formats', { url: el('downloadYoutubeUrl').value.trim() }, { retry: true, signal: controller?.signal, timeout: 145000 });
      if (ticket !== checkSequence) return;
      inspection = next;
      el('downloadVideoTitle').textContent = inspection.title;
      renderFormats();
      if (availableFormats().length) message('Choose a format and quality.');
    } catch (error) { if (ticket === checkSequence && error.name !== 'AbortError') message(error.message, true); }
    finally { if (ticket === checkSequence) { checking = false; checkController = null; el('checkYoutubeFormats').disabled = false; } }
  });

  el('downloadYoutubeUrl').addEventListener('input', () => {
    if (preparing) return;
    checkSequence++; checkController?.abort(); checkController = null; checking = false; inspection = null;
    el('downloadSelection').hidden = true; el('checkYoutubeFormats').disabled = false;
    message('');
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
      savedJob.set(job.id); pollFailures = 0; pollPaused = false;
      renderJob();
      poll();
    } catch (error) { message(error.message, true); preparing = false; el('prepareYoutubeDownload').disabled = false; }
  });

  el('cancelYoutubeDownload').addEventListener('click', async () => {
    if (!job) return;
    pollSequence++; clearTimeout(polling);
    try {
      job = await request(`/api/youtube/downloads/${job.id}/cancel`, {});
      clearTimeout(polling);
      savedJob.clear(); pollPaused = false;
      renderJob();
    } catch (error) { message(error.message, true); if (['downloading', 'converting'].includes(job.state)) polling = setTimeout(poll, 1200); }
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

  const saved = savedJob.get();
  const restoreCheck = checkSequence, restorePoll = pollSequence;
  const canRestore = () => checkSequence === restoreCheck && pollSequence === restorePoll && !job;
  if (/^[a-f0-9-]{36}$/.test(saved || '')) request(`/api/youtube/downloads/${saved}`, null, { retry: true }).then((data) => {
    if (!canRestore()) return;
    job = data; renderJob(); poll();
  }).catch(error => {
    if (!canRestore()) return;
    if (error.status && error.status >= 400 && error.status < 500) { savedJob.clear(); return; }
    job = { id: saved, state: 'downloading', progress: 0 }; pollPaused = true; renderJob();
    message('Connection lost. Reconnect to check your download.', true);
  });
})();
