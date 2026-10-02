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
      if (error) reject(new Error(error.code === 'ENOENT' ? 'Download tools are missing. Run setup-download-tools.ps1 on the admin laptop.' : path.basename(file).startsWith('yt-dlp') ? downloadError(stderr || error.message) : String(stderr || error.message).trim().slice(-1200)));
      else resolve(stdout);
    });
    if (options.onData) child.stdout.on('data', options.onData);
  });
}

const common = () => ['--ignore-config', '--no-playlist', '--no-colors', '--force-ipv4', '--cache-dir', YT_CACHE, '--socket-timeout', '20', '--retries', '2', '--js-runtimes', `node:${process.execPath}`];

function downloadError(stderr) {
  if (/429|Too Many Requests/i.test(stderr)) return 'YouTube is temporarily limiting download requests. Try later, or convert an already saved video to MP3 below.';
  if (/Sign in to confirm|not a bot/i.test(stderr)) return 'YouTube requires a sign-in check for this request. You can convert an already saved video to MP3 below.';
  if (/HTTP (?:Error )?403|403: Forbidden/i.test(stderr)) return 'YouTube refused this media stream (403). Check the link again to refresh its formats, or try another quality. Some videos require access that this downloader cannot provide.';
  if (/PermissionError|Access is denied|EACCES/i.test(stderr)) return 'CineWall cannot write its download cache. Make sure the CineWall folder is writable.';
  const errors = String(stderr).split(/\r?\n/).filter((line) => /^ERROR:/i.test(line.trim()));
  return (errors.at(-1) || String(stderr).trim() || 'YouTube could not provide this download.').slice(-1200);
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
        selector: combined ? String(f.format_id) : `${f.format_id}+${audio.format_id}`, codec: f.vcodec });
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
    if (m4a) choices.push({ id: randomUUID(), kind: 'audio', container: 'm4a', label: 'Original audio', selector: String(m4a.format_id), size: m4a.filesize || m4a.filesize_approx || 0 });
    choices.push({ id: randomUUID(), kind: 'audio', container: 'wav', label: 'WAV audio', selector: String(audio.format_id), fallbackSelectors, size: 0 });
  }
  return choices;
}

async function inspect(videoId) {
  if (inspecting >= 2) throw new Error('Another video is being checked. Try again in a moment.');
  inspecting += 1;
  try {
    const info = JSON.parse(await run(executable('yt-dlp'), [...common(), '--dump-single-json', '--skip-download', '--', `https://www.youtube.com/watch?v=${videoId}`]));
    if (info.is_live) throw new Error('A live stream cannot be downloaded while it is broadcasting. Choose a recorded video.');
    const options = downloadChoices(info);
    if (!options.length) throw new Error('No downloadable formats were found for this video.');
    for (const [id, entry] of inspections) if (entry.expires < Date.now()) inspections.delete(id);
    const id = randomUUID();
    const entry = { id, videoId, title: info.title || videoId, duration: Number(info.duration) || 0, options, expires: Date.now() + 30 * 60 * 1000 };
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
  if (option.container === 'mp3') {
    const cached = [...jobs.values()].find((job) => (job.room || '') === room && job.state === 'ready' && job.option.kind === 'video' && job.videoId === info.videoId && fs.existsSync(job.path));
    if (cached) return convertSavedVideo(cached.id, option.bitrate);
  }
  const id = randomUUID();
  const directory = path.join(ROOT, id);
  fs.mkdirSync(directory);
  const cleanTitle = info.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 150).replace(/[. ]+$/, '') || 'YouTube video';
  const job = { id, room, videoId: info.videoId, title: info.title, fileName: `${cleanTitle}.${option.container}`, option, directory, state: 'downloading', progress: 0, error: '', path: null, created: Date.now(), attempt: 0 };
  jobs.set(id, job);
  launch(job);
  return publicJob(job);
}

function launch(job) {
  const { option, directory, id } = job;
  const selector = job.attempt ? (option.fallbackSelectors || [])[job.attempt - 1] : option.selector;
  const args = [...common(), ...(job.attempt ? ['--no-cache-dir'] : []), '--newline', '--progress', '--progress-template', 'download:CINEWALL_PROGRESS:%(progress._percent_str)s',
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
      if (/HTTP (?:Error )?403|403: Forbidden/i.test(stderr) && job.attempt < Math.min(2, (option.fallbackSelectors || []).length)) {
        job.attempt += 1;
        job.state = 'downloading';
        job.progress = 0;
        job.message = 'Refreshing the download with another available audio stream…';
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
      if (metadata.id !== entry.name || !['mp4', 'webm', 'mp3', 'm4a', 'wav'].includes(metadata.option?.container)) continue;
      const filePath = path.join(directory, `media.${metadata.option.container}`);
      if (!fs.existsSync(filePath)) continue;
      jobs.set(entry.name, { ...metadata, directory, path: filePath, state: 'ready', progress: 100, error: '', created: fs.statSync(filePath).mtimeMs, child: null });
    } catch {}
  }
}

function savedVideos() {
  return [...jobs.values()].filter((job) => job.state === 'ready' && job.option.kind === 'video' && fs.existsSync(job.path))
    .sort((a, b) => b.created - a.created).map(publicJob);
}

function convertSavedVideo(sourceId, requestedBitrate = 320) {
  const source = get(sourceId);
  const bitrate = Number(requestedBitrate);
  if (![96, 128, 192, 256, 320].includes(bitrate)) throw new Error('Select a supported MP3 bitrate.');
  if (source.state !== 'ready' || source.option.kind !== 'video' || !fs.existsSync(source.path)) throw new Error('Choose a successfully saved video first.');
  if ([...jobs.values()].some((job) => ['downloading', 'converting'].includes(job.state))) throw new Error('Another download or conversion is still preparing.');
  const id = randomUUID();
  const directory = path.join(ROOT, id);
  fs.mkdirSync(directory);
  const filePath = path.join(directory, 'media.mp3');
  const job = { id, room: source.room || '', videoId: source.videoId, directory, path: null, title: source.title, fileName: source.fileName.replace(/\.[^.]+$/, '.mp3'),
    state: 'converting', progress: 0, error: '', created: Date.now(), option: { kind: 'audio', container: 'mp3', bitrate } };
  jobs.set(id, job);
  const child = spawn(executable('ffmpeg'), ['-nostdin', '-y', '-v', 'error', '-i', source.path, '-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', `${bitrate}k`, filePath], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  job.child = child;
  let stderr = '';
  const timer = setTimeout(() => { job.error = 'Audio conversion exceeded the time limit.'; cancel(id); }, 60 * 60 * 1000);
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-1200); });
  child.on('error', (error) => { clearTimeout(timer); job.state = 'error'; job.error = error.message; });
  child.on('close', (code) => {
    clearTimeout(timer);
    job.child = null;
    if (job.state === 'cancelled' || job.state === 'error') return;
    if (code !== 0 || !fs.existsSync(filePath)) { job.state = 'error'; job.error = stderr || 'This saved video could not be converted to MP3.'; return; }
    job.path = filePath;
    job.state = 'ready';
    job.progress = 100;
    persistReadyJob(job);
  });
  return publicJob(job);
}

async function copyForWall(id, destination, options = {}) {
  const job = get(id);
  if (job.state !== 'ready' || job.option.kind !== 'video' || job.option.container !== 'mp4') throw new Error('Prepare an MP4 video before loading the wall.');
  const prepared = await prepareWallVideo(job.path, destination, options);
  if (prepared.path !== destination) await fs.promises.copyFile(prepared.path, destination);
  return { name: job.fileName, size: (await fs.promises.stat(destination)).size };
}

async function prepareWallVideo(input, destination, options = {}) {
  const info = JSON.parse(await run(executable('ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input], 30000, options));
  const video = info.streams?.find((stream) => stream.codec_type === 'video');
  const audio = info.streams?.find((stream) => stream.codec_type === 'audio');
  if (!video) throw new Error('This file does not contain a video track.');
  const compatible = ['h264', 'av1', 'vp9'].includes(video.codec_name) && ['yuv420p', 'yuvj420p'].includes(video.pix_fmt) && (!audio || ['aac', 'mp3', 'opus'].includes(audio.codec_name));
  if (!compatible && !options.allowTranscode) throw new Error(`This file uses ${video.codec_name}/${audio?.codec_name || 'no audio'}. Direct local playback or a lossless remux may work in your browser. Enable lossy compatibility conversion explicitly if needed; CineWall will not reduce quality automatically.`);
  if (compatible && path.extname(input).toLowerCase() === '.mp4') { options.onProgress?.(100, 'unchanged'); return { path: input, converted: false, lossless: true }; }
  const args = ['-nostdin', '-y', '-v', 'error', '-nostats', '-progress', 'pipe:1', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-sn'];
  if (compatible) args.push('-c', 'copy');
  else args.push('-vf', "scale=w='min(1920,iw)':h=-2,format=yuv420p", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac');
  args.push('-movflags', '+faststart', destination);
  let output = '';
  const duration = Number(info.format?.duration) || Number(video.duration) || 0;
  const method = compatible ? 'remux' : 'transcode';
  options.onProgress?.(0, method);
  await run(executable('ffmpeg'), args, 60 * 60 * 1000, { signal: options.signal, onData(chunk) {
    output = (output + chunk).slice(-3000);
    const times = [...output.matchAll(/out_time_us=(\d+)/g)];
    if (duration && times.length) options.onProgress?.(Math.min(99, Number(times.at(-1)[1]) / 1000000 / duration * 100), method);
  } });
  options.onProgress?.(100, method);
  return { path: destination, converted: true, lossless: compatible };
}

restoreReadyJobs();
module.exports = { capabilities, inspect, start, get, publicJob, cancel, copyForWall, prepareWallVideo, downloadChoices, downloadError, common, savedVideos, convertSavedVideo };
