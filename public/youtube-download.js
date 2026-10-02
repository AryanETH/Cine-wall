'use strict';

(() => {
  const el = (id) => document.getElementById(id);
  let inspection = null;
  let job = null;
  let polling = null;
  let checking = false;
  let preparing = false;
  let savedListJob = '';

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

  function selectedOption() { return inspection?.formats.find((option) => option.id === el('downloadQuality').value); }

  function renderQualities() {
    const formats = inspection.formats.filter((option) => option.container === el('downloadContainer').value);
    el('downloadQuality').replaceChildren(...formats.map((format) => new Option(format.label, format.id)));
    renderSize();
  }

  function renderSize() {
    const option = selectedOption();
    el('downloadSizeHint').textContent = option?.size ? `Estimated file size · ${(option.size / 1024 / 1024).toFixed(1)} MB` : 'Size is calculated during preparation.';
  }

  function renderJob() {
    const active = job && ['downloading', 'converting'].includes(job.state);
    preparing = Boolean(active);
    el('prepareYoutubeDownload').disabled = preparing;
    el('checkYoutubeFormats').disabled = preparing || checking;
    el('downloadContainer').disabled = preparing;
    el('downloadQuality').disabled = preparing;
    el('convertSavedAudio').disabled = preparing;
    el('savedVideoSource').disabled = preparing;
    el('savedAudioBitrate').disabled = preparing;
    el('cancelYoutubeDownload').hidden = !active;
    el('youtubeDownloadProgress').hidden = !active;
    el('youtubeDownloadProgress').value = job?.progress || 0;
    el('saveYoutubeDownload').hidden = job?.state !== 'ready';
    el('loadYoutubeDownload').hidden = !(job?.state === 'ready' && job.container === 'mp4' && job.kind === 'video');
    if (!job) return;
    if (job.state === 'downloading') message(job.message || `Downloading · ${Math.round(job.progress)}%`);
    else if (job.state === 'converting') message(`Preparing ${job.container.toUpperCase()} · ${job.kind === 'audio' ? 'converting audio' : 'merging video and audio'}`);
    else if (job.state === 'ready') {
      el('saveYoutubeDownload').href = window.CineWallSession?.link(job.downloadUrl) || job.downloadUrl;
      el('saveYoutubeDownload').download = job.fileName;
      message(job.kind === 'audio' ? 'Your audio file is ready. Choose Save file.' : 'Ready. Save the file, or use this MP4 on the video wall.');
      if (savedListJob !== job.id) { savedListJob = job.id; refreshSavedVideos(); }
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

  async function refreshSavedVideos() {
    try {
      const data = await request('/api/youtube/saved-videos');
      el('savedVideoAudio').hidden = !data.videos.length;
      const selected = el('savedVideoSource').value;
      el('savedVideoSource').replaceChildren(...data.videos.map((video) => new Option(video.title, video.id)));
      if (data.videos.some((video) => video.id === selected)) el('savedVideoSource').value = selected;
    } catch { el('savedVideoAudio').hidden = true; }
  }

  el('convertSavedAudio').addEventListener('click', async () => {
    if (preparing || !el('savedVideoSource').value) return;
    el('convertSavedAudio').disabled = true;
    message('Converting the saved video to MP3…');
    try {
      job = await request(`/api/youtube/downloads/${el('savedVideoSource').value}/audio`, { bitrate: Number(el('savedAudioBitrate').value) });
      sessionStorage.setItem('cinewall-download-job', job.id);
      renderJob();
      poll();
    } catch (error) { message(error.message, true); el('convertSavedAudio').disabled = false; }
  });

  function chooseSource(open) {
    el('youtubeDownloadPanel').hidden = !open;
    el('localVideoSource').classList.toggle('active', !open);
    el('localVideoSource').setAttribute('aria-pressed', String(!open));
    el('downloadYoutubeToggle').classList.toggle('active', open);
    el('downloadYoutubeToggle').setAttribute('aria-pressed', String(open));
    el('downloadYoutubeToggle').setAttribute('aria-expanded', String(open));
    el('fileSourceButton').hidden = open;
    el('dropZone').hidden = open;
    if (open) el('downloadYoutubeUrl').focus();
    if (open) refreshSavedVideos();
  }
  el('downloadYoutubeToggle').addEventListener('click', () => chooseSource(true));
  el('localVideoSource').addEventListener('click', () => chooseSource(false));

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
      if (!tools.ready) throw new Error('The download tools need setup. Run setup-download-tools.ps1 on the admin laptop, then try again.');
      inspection = await request('/api/youtube/formats', { url: el('downloadYoutubeUrl').value.trim() });
      el('downloadVideoTitle').textContent = inspection.title;
      const containers = [...new Set(inspection.formats.map((option) => option.container))];
      el('downloadContainer').replaceChildren(...containers.map((container) => new Option(container.toUpperCase(), container)));
      renderQualities();
      el('downloadSelection').hidden = false;
      message('Choose a format and quality.');
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
    if (!job || job.state !== 'ready') return;
    el('loadYoutubeDownload').disabled = true;
    message('Preparing this video for every display…');
    try {
      await request(`/api/youtube/downloads/${job.id}/load`, {});
      message('Video loaded on the wall. Press Play to start the joined displays.');
    } catch (error) { message(error.message, true); }
    finally { el('loadYoutubeDownload').disabled = false; }
  });

  const saved = sessionStorage.getItem('cinewall-download-job');
  if (/^[a-f0-9-]{36}$/.test(saved || '')) request(`/api/youtube/downloads/${saved}`).then((data) => { job = data; renderJob(); poll(); }).catch(() => sessionStorage.removeItem('cinewall-download-job'));
  refreshSavedVideos();
})();
