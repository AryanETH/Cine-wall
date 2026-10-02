'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const CACHE_ROOT = path.resolve(process.env.CINEWALL_CACHE_DIR || path.join(__dirname, '.cinema-cache'));
const ROOT = path.join(CACHE_ROOT, 'downloads');
const TOOLS = path.join(__dirname, 'tools');
const YT_CACHE = path.join(CACHE_ROOT, 'yt-dlp-cache');
const inspections = new Map();
const jobs = new Map();
const MAX_FILE = 10 * 1024 ** 3;
let inspecting = 0;
fs.mkdirSync(ROOT, { recursive: true });
fs.mkdirSync(YT_CACHE, { recursive: true });

function executable(name) {
  const bundled = path.join(TOOLS, process.platform === 'win32' ? `${name}.exe` : name);
  return fs.existsSync(bundled) ? bundled : name;
}

function run(file, args, timeout = 120000, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { windowsHide: true, timeout, maxBuffer: 24 * 1024 * 1024, signal: options.signal }, (error, stdout, stderr) => {
      if (error) {
        const failure = new Error(error.code === 'ENOENT' ? 'Download tools are missing. Run setup-download-tools.ps1 on the admin laptop.' : path.basename(file).startsWith('yt-dlp') ? downloadError(stderr || error.message) : String(stderr || error.message).trim().slice(-1200));
        failure.causeText = String(stderr || error.message);
        reject(failure);
      }
      else resolve(stdout);
    });
    if (options.onData) child.stdout.on('data', options.onData);
  });
}

const common = () => ['--ignore-config', '--no-playlist', '--no-colors', '--cache-dir', YT_CACHE, '--socket-timeout', '20', '--retries', '2', '--fragment-retries', '3', '--extractor-retries', '2', '--abort-on-unavailable-fragments', '--js-runtimes', `node:${process.execPath}`];

function networkError(detail) {
  return /WinError 10013|socket.*(?:forbidden|permission)|Failed to establish a new connection|Network is unreachable|No route to host|Temporary failure in name resolution|Name or service not known|timed out|Connection (?:reset|aborted)/i.test(String(detail));
}

function routeArgs(route) {
  if (route === 1) return ['--extractor-args', 'youtube:player_client=web_embedded;player_skip=webpage,configs;innertube_host=youtubei.googleapis.com'];
  if (route === 2) return ['--force-ipv6', '--extractor-args', 'youtube:player_client=web_embedded;player_skip=webpage,configs;innertube_host=youtubei.googleapis.com'];
  return [];
}

async function fetchVideoInfo(videoId, options = {}) {
  let lastError;
  let blockedError;
  for (let route = 0; route < 3; route++) {
    try {
      const output = await run(executable('yt-dlp'), [...common(), ...routeArgs(route), ...(options.fresh ? ['--no-cache-dir'] : []), '--dump-single-json', '--skip-download', '--', `https://www.youtube.com/watch?v=${videoId}`], 120000, options);
      return { info: JSON.parse(output), route };
    } catch (error) {
      lastError = error;
      if (/WinError 10013/i.test(error.causeText || '')) blockedError = error;
      if (!networkError(error.causeText || error.message)) break;
    }
  }
  throw blockedError || lastError;
}

function refreshableDownloadError(stderr) {
  return !/429|Too Many Requests|Sign in|not a bot|private video|members.only|age.restricted|DRM|PO Token|PO_TOKEN/i.test(stderr)
    && /HTTP (?:Error )?(?:403|5\d\d)|403: Forbidden|Requested format is not available|timed out|Connection (?:reset|aborted)|Temporary failure/i.test(stderr);
}

function equivalentChoice(choices, option) {
  return choices.find((choice) => choice.kind === option.kind && choice.container === option.container
    && (option.kind === 'video' ? choice.height === option.height && choice.fps === option.fps : choice.bitrate === option.bitrate));
}

function downloadError(stderr) {
  if (/WinError 10013|socket.*(?:forbidden|permission)/i.test(stderr)) return 'Windows blocked the YouTube connection. Check firewall or network access for CineWall, then try again.';
  if (/429|Too Many Requests/i.test(stderr)) return 'YouTube is temporarily limiting downloads. Try again later.';
  if (/Sign in to confirm|not a bot/i.test(stderr)) return 'YouTube requires a sign-in check for this video.';
  if (/HTTP (?:Error )?403|403: Forbidden/i.test(stderr)) return 'YouTube refused this media stream (403). Check the link again to refresh its formats, or try another quality. Some videos require access that this downloader cannot provide.';
  if (/PermissionError|Access is denied|EACCES/i.test(stderr)) return 'CineWall cannot write its download cache. Make sure the CineWall folder is writable.';
  if (networkError(stderr)) return 'Could not reach YouTube. Check your internet connection and try again.';
  if (/private video|members.only|age.restricted|DRM|PO Token|PO_TOKEN/i.test(stderr)) return 'YouTube does not allow this video to be downloaded here. Try another video.';
  return 'YouTube could not provide this download. Try another link or quality.';
}

async function capabilities() {
  const checks = await Promise.allSettled([run(executable('yt-dlp'), ['--version'], 10000), run(executable('ffmpeg'), ['-version'], 10000)]);
  return { downloader: checks[0].status === 'fulfilled', converter: checks[1].status === 'fulfilled', ready: checks.every((check) => check.status === 'fulfilled') };
}

function audioFormat(formats, extension) {
  return formats.filter((f) => f.vcodec === 'none' && f.acodec !== 'none' && (!extension || f.ext === extension))
    .sort((a, b) => Number(Boolean(b.audio_track?.audio_is_default)) - Number(Boolean(a.audio_track?.audio_is_default)) || (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0))[0];
}

function downloadChoices(info) {
  const formats = (info.formats || []).filter((f) => /^[\w.-]+$/.test(String(f.format_id)) && !f.has_drm && f.url);
  const choices = [];
  for (const container of ['mp4', 'webm']) {
    const audio = audioFormat(formats, container === 'mp4' ? 'm4a' : 'webm');
    const candidates = formats.filter((f) => f.ext === container && f.vcodec && f.vcodec !== 'none' && f.height > 0)
      .sort((a, b) => b.height - a.height || (b.fps || 0) - (a.fps || 0) || Number(String(b.vcodec).startsWith('avc')) - Number(String(a.vcodec).startsWith('avc')) || (b.tbr || 0) - (a.tbr || 0));
    const seen = new Set();
    for (const f of candidates) {
      const combined = f.acodec && f.acodec !== 'none';
      if (!combined && !audio) continue;
      const fps = f.fps > 30 ? Math.round(f.fps) : 30;
      const key = `${f.height}-${fps}`;
      if (seen.has(key)) continue;
      seen.add(key);
      choices.push({ id: randomUUID(), kind: 'video', container, height: f.height, fps,
        label: `${f.height}p${f.fps > 30 ? ` · ${Math.round(f.fps)} fps` : ''}`, size: (f.filesize || f.filesize_approx || 0) + (combined ? 0 : audio.filesize || audio.filesize_approx || 0),
        selector: combined ? String(f.format_id) : `${f.format_id}+${audio.format_id}`, codec: f.vcodec,
        fallbackSelectors: candidates.filter((candidate) => candidate.format_id !== f.format_id && candidate.height === f.height && (candidate.fps || 30) === (f.fps || 30)
          && ((candidate.acodec && candidate.acodec !== 'none') || audio)).map((candidate) => candidate.acodec && candidate.acodec !== 'none' ? String(candidate.format_id) : `${candidate.format_id}+${audio.format_id}`).slice(0, 2) });
    }
  }
  // AAC/M4A uses the same stream family as MP4 and is generally the most
  // reliable source for MP3 conversion. Keep other available streams as fallbacks.
  const m4a = audioFormat(formats, 'm4a');
  const bestAudio = audioFormat(formats);
  const combinedAudio = formats.find((format) => format.acodec && format.acodec !== 'none' && format.vcodec && format.vcodec !== 'none');
  const audio = m4a || bestAudio || combinedAudio;
  const fallbackSelectors = [bestAudio, combinedAudio].filter((format) => format && format.format_id !== audio?.format_id).map((format) => String(format.format_id));
  if (audio) {
    for (const bitrate of [320, 256, 192, 128, 96]) choices.push({ id: randomUUID(), kind: 'audio', container: 'mp3', bitrate,
      label: `${bitrate} kbps`, selector: String(audio.format_id), fallbackSelectors, size: Math.round((info.duration || 0) * bitrate * 125) });
    // An existing AAC stream may be copied, so do not promise a higher bitrate.
    choices.push({ id: randomUUID(), kind: 'audio', container: 'aac', label: 'Best available AAC',
      selector: String(audio.format_id), fallbackSelectors, size: m4a?.filesize || m4a?.filesize_approx || 0 });
    if (m4a) choices.push({ id: randomUUID(), kind: 'audio', container: 'm4a', label: 'Original audio', selector: String(m4a.format_id), size: m4a.filesize || m4a.filesize_approx || 0 });
    choices.push({ id: randomUUID(), kind: 'audio', container: 'wav', label: 'WAV audio', selector: String(audio.format_id), fallbackSelectors, size: 0 });
  }
  return choices;
}

async function inspect(videoId) {
  if (inspecting >= 2) throw new Error('Another video is being checked. Try again in a moment.');
  inspecting += 1;
  try {
    const { info, route } = await fetchVideoInfo(videoId);
    if (info.is_live) throw new Error('A live stream cannot be downloaded while it is broadcasting. Choose a recorded video.');
    const options = downloadChoices(info);
    if (!options.length) throw new Error('No downloadable formats were found for this video.');
    for (const [id, entry] of inspections) if (entry.expires < Date.now()) inspections.delete(id);
    const id = randomUUID();
    const entry = { id, videoId, title: info.title || videoId, duration: Number(info.duration) || 0, options, route, expires: Date.now() + 30 * 60 * 1000 };
    inspections.set(id, entry);
    return { id, videoId, title: entry.title, duration: entry.duration, thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      formats: options.map(({ selector, codec, fallbackSelectors: privateFallbacks, ...option }) => option) };
  } finally { inspecting -= 1; }
}

function publicJob(job) {
  return { id: job.id, state: job.state, progress: job.progress, title: job.title, container: job.option.container, kind: job.option.kind,
    error: job.error, message: job.message || '', fileName: job.fileName, downloadUrl: job.state === 'ready' ? `/api/youtube/downloads/${job.id}/file` : null };
}

function start(inspectionId, optionId, room = '') {
  const info = inspections.get(String(inspectionId));
  if (!info || info.expires < Date.now()) throw new Error('These video formats have expired. Check the link again.');
  const option = info.options.find((item) => item.id === optionId);
  if (!option) throw new Error('Select an available quality from the list.');
  if ([...jobs.values()].some((job) => ['downloading', 'converting'].includes(job.state))) throw new Error('Another download is still preparing. Wait for it to finish or cancel it.');
  const id = randomUUID();
  const directory = path.join(ROOT, id);
  fs.mkdirSync(directory);
  const cleanTitle = info.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 150).replace(/[. ]+$/, '') || 'YouTube video';
  const job = { id, room, videoId: info.videoId, title: info.title, fileName: `${cleanTitle}.${option.container}`, option, directory, state: 'downloading', progress: 0, error: '', path: null, created: Date.now(), attempt: 0, route: info.route || 0 };
  jobs.set(id, job);
  launch(job);
  return publicJob(job);
}

async function refreshJobFormats(job) {
  job.state = 'downloading'; job.progress = 0; job.message = 'Refreshing available streams at your selected quality…'; job.refreshed = true;
  job.refreshAbort = new AbortController();
  try {
    const { info, route } = await fetchVideoInfo(job.videoId, { fresh: true, signal: job.refreshAbort.signal });
    if (job.state === 'cancelled') return;
    const next = equivalentChoice(downloadChoices(info), job.option);
    if (!next) throw new Error('The selected quality is no longer available. Check the link again; CineWall will not silently lower the quality.');
    job.option = { ...next, id: job.option.id };
    job.attempt = 0;
    job.route = route;
    launch(job);
  } catch (error) {
    if (job.state === 'cancelled') return;
    job.state = 'error'; job.error = error.message;
  } finally {
    job.refreshAbort = null;
  }
}

function launch(job) {
  const { option, directory, id } = job;
  const selector = job.attempt ? (option.fallbackSelectors || [])[job.attempt - 1] : option.selector;
  const args = [...common(), ...routeArgs(job.route || 0), ...(job.attempt || job.refreshed || job.route ? ['--no-cache-dir', '--force-overwrites', '--no-continue'] : []), '--newline', '--progress', '--progress-template', 'download:CINEWALL_PROGRESS:%(progress._percent_str)s',
    '--max-filesize', String(MAX_FILE), ...(path.isAbsolute(executable('ffmpeg')) ? ['--ffmpeg-location', TOOLS] : []), '-f', selector, '-o', path.join(directory, 'media.%(ext)s')];
  if (option.kind === 'audio') args.push('-x', '--audio-format', option.container, '--audio-quality', option.bitrate ? `${option.bitrate}K` : '0');
  else args.push('--merge-output-format', option.container, '--remux-video', option.container);
  args.push('--', `https://www.youtube.com/watch?v=${job.videoId}`);
  const child = spawn(executable('yt-dlp'), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  job.child = child;
  let stderr = '';
  let output = '';
  const readProgress = (chunk) => {
    output = (output + chunk.toString()).slice(-4000);
    const matches = [...output.matchAll(/CINEWALL_PROGRESS:\s*([\d.]+)%/g)];
    if (matches.length) { job.progress = Math.min(99, Number(matches.at(-1)[1])); job.message = ''; }
    if (/\[(Merger|ExtractAudio|VideoRemuxer)\]/.test(chunk.toString())) job.state = 'converting';
  };
  child.stdout.on('data', readProgress);
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-3000); readProgress(chunk); });
  const timer = setTimeout(() => { job.error = 'Download exceeded the time limit. Try a shorter video or lower quality.'; cancel(id); }, 60 * 60 * 1000);
  child.on('error', (error) => { job.state = 'error'; job.error = error.code === 'ENOENT' ? 'Download tools are missing. Run setup-download-tools.ps1.' : error.message; clearTimeout(timer); });
  child.on('close', (code) => {
    clearTimeout(timer);
    job.child = null;
    if (job.state === 'cancelled' || job.state === 'error') return;
    if (code !== 0) {
      if (networkError(stderr) && (job.route || 0) < 2) {
        job.route = (job.route || 0) + 1;
        job.state = 'downloading';
        job.progress = 0;
        job.message = 'Trying another YouTube connection…';
        launch(job);
        return;
      }
      if (refreshableDownloadError(stderr) && !job.refreshed) { refreshJobFormats(job); return; }
      if (refreshableDownloadError(stderr) && job.attempt < Math.min(2, (option.fallbackSelectors || []).length)) {
        job.attempt += 1;
        job.state = 'downloading';
        job.progress = 0;
        job.message = option.kind === 'audio' ? 'Retrying another available audio stream…' : 'Retrying another stream at the same video quality…';
        launch(job);
        return;
      }
      job.state = 'error'; job.error = downloadError(stderr); return;
    }
    const file = fs.readdirSync(directory).find((name) => name === `media.${option.container}`);
    if (!file) { job.state = 'error'; job.error = 'The requested output file was not created.'; return; }
    job.path = path.join(directory, file);
    if (fs.statSync(job.path).size > MAX_FILE) { job.state = 'error'; job.error = 'This download exceeds the 10 GB limit.'; return; }
    job.state = 'ready';
    job.progress = 100;
    persistReadyJob(job);
  });
}

function get(id) {
  const job = jobs.get(String(id));
  if (!job) throw new Error('Download not found. Check the link and prepare it again.');
  return job;
}

function cancel(id) {
  const job = get(id);
  if (!['downloading', 'converting'].includes(job.state)) return publicJob(job);
  job.state = 'cancelled';
  job.refreshAbort?.abort();
  if (job.child) {
    if (process.platform === 'win32') execFile('taskkill', ['/PID', String(job.child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    else job.child.kill('SIGTERM');
  }
  return publicJob(job);
}

function persistReadyJob(job) {
  const metadata = { id: job.id, room: job.room || '', videoId: job.videoId || null, title: job.title, fileName: job.fileName,
    option: { kind: job.option.kind, container: job.option.container, codec: job.option.codec || null } };
  try { fs.writeFileSync(path.join(job.directory, 'job.json'), JSON.stringify(metadata), 'utf8'); } catch {}
}

function restoreReadyJobs() {
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
    try {
      const directory = path.join(ROOT, entry.name);
      const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'job.json'), 'utf8'));
      if (metadata.id !== entry.name || !['mp4', 'webm', 'mp3', 'm4a', 'aac', 'wav'].includes(metadata.option?.container)) continue;
      const filePath = path.join(directory, `media.${metadata.option.container}`);
      if (!fs.existsSync(filePath)) continue;
      jobs.set(entry.name, { ...metadata, directory, path: filePath, state: 'ready', progress: 100, error: '', created: fs.statSync(filePath).mtimeMs, child: null });
    } catch {}
  }
}

async function copyForWall(id, destination, options = {}) {
  const job = get(id);
  if (job.state !== 'ready' || job.option.kind !== 'video' || job.option.container !== 'mp4') throw new Error('Prepare an MP4 video before loading the wall.');
  await inspectBrowserVideo(job.path, '.mp4', options);
  await fs.promises.copyFile(job.path, destination);
  return { name: job.fileName, size: (await fs.promises.stat(destination)).size };
}

async function copyForSpeakers(id, destination) {
  const job = get(id);
  if (job.state !== 'ready' || job.option.kind !== 'audio' || !['mp3', 'm4a', 'aac', 'wav'].includes(job.option.container) || !job.path || !fs.existsSync(job.path)) throw new Error('Prepare an MP3, AAC, M4A or WAV audio download first.');
  await fs.promises.copyFile(job.path, destination);
  const types = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav' };
  return { name: job.fileName, size: (await fs.promises.stat(destination)).size, type: types[job.option.container] };
}

async function inspectBrowserVideo(input, extension, options = {}) {
  extension = String(extension).toLowerCase();
  const info = JSON.parse(await run(executable('ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input], 30000, options));
  const video = info.streams?.find((stream) => stream.codec_type === 'video');
  const audioTracks = info.streams?.filter((stream) => stream.codec_type === 'audio') || [];
  const audio = audioTracks[0];
  const browserHint = 'This video uses unsupported tracks. Use MP4 with H.264 video and AAC audio for best compatibility.';
  if (!video) throw new Error(`No video track found. ${browserHint}`);
  const mkv = extension === '.mkv', webm = extension === '.webm';
  const formats = String(info.format?.format_name || '').split(',');
  const correctContainer = mkv || webm ? formats.includes('matroska') : formats.includes('mp4');
  const supportedVideo = webm ? ['vp8', 'vp9'].includes(video.codec_name) : mkv ? video.codec_name === 'h264' && ['Baseline', 'Constrained Baseline', 'Main', 'Extended', 'High'].includes(video.profile) : ['h264', 'vp9', 'av1'].includes(video.codec_name);
  const supportedAudio = audioTracks.every((track) => webm ? ['opus', 'vorbis'].includes(track.codec_name) : track.codec_name === 'aac' && (!mkv || ['Main', 'LC', 'HE-AAC', 'HE-AACv2'].includes(track.profile)));
  if (!['.mp4', '.m4v', '.webm', '.mkv'].includes(extension) || !correctContainer || !supportedVideo || !supportedAudio || !['yuv420p', 'yuvj420p'].includes(video.pix_fmt)) throw new Error(browserHint);
  return { video: video.codec_name, audio: audio?.codec_name || null };
}

restoreReadyJobs();
module.exports = { capabilities, inspect, start, get, publicJob, cancel, copyForWall, copyForSpeakers, inspectBrowserVideo, downloadChoices, downloadError, common, refreshableDownloadError, equivalentChoice };
