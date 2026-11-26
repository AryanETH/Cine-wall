'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const run = promisify(execFile);
const cacheBudget = require('./cache-budget');
const { parse } = require('./public/captions');
const serveAsset = require('./static-assets');
const http = require('node:http');
const { randomBytes, createHash } = require('node:crypto');
let active = 0;
const AUDIO_WINDOW_SECONDS = 90;
function audioStart(position = 0) {
  if (!Number.isFinite(position) || position < 0 || position > 604800) throw fail(400, 'Invalid audio position.');
  return Math.floor(position / AUDIO_WINDOW_SECONDS) * AUDIO_WINDOW_SECONDS;
}
const fail = (status, text) => Object.assign(Error(text), { status });
const label = (stream, index) => [stream.tags?.title, stream.tags?.language].filter(Boolean).join(' · ').slice(0, 120) || 'Track ' + (index + 1);

module.exports = function playerTracks({ asset, file, changed, peerStream, directory }) {
  let version = '', listing, uploaded, options;
  let controller = new AbortController();
  const pending = new Map(), outputs = new Set();
  let bridge, bridgeReady;
  function reset() {
    controller.abort(); controller = new AbortController();
    bridge?.closeAllConnections(); bridge?.close(); bridge = undefined; bridgeReady = undefined;
    for (const output of outputs) fs.promises.unlink(output).catch(() => {});
    outputs.clear(); pending.clear(); listing = undefined; uploaded = undefined;
    version = asset()?.version || '';
    options = { version, audio: null, audioWindowSeconds: AUDIO_WINDOW_SECONDS, captions: 'off', captionRevision: 0, size: 32, x: 50, y: 84, width: 70 };
  }
  function sync() { if (!options || version !== (asset()?.version || '')) reset(); return options; }
  async function source() {
    sync();
    if (!version || asset()?.kind === 'audio') throw fail(409, 'Choose a video first.');
    const peer = asset()?.source === 'peer';
    let input;
    if (peer) {
      if (!peerStream) throw fail(409, 'Keep the source dashboard open to read this video’s tracks.');
      if (!bridgeReady) {
        const secret = '/' + randomBytes(32).toString('hex'), generation = version;
        // FFmpeg reads bounded ranges from the existing authenticated source tab.
        // This private listener accepts only its unpredictable path on loopback.
        const listener = http.createServer((req, res) => {
          if (req.url !== secret || generation !== version || !['GET', 'HEAD'].includes(req.method)) {
            res.writeHead(404); res.end(); return;
          }
          Promise.resolve(peerStream(req, res, generation)).catch(() => { if (!res.headersSent) res.writeHead(502); res.end(); });
        });
        listener.requestTimeout = 30000; listener.headersTimeout = 10000;
        bridge = listener;
        bridgeReady = new Promise((resolve, reject) => {
          listener.once('error', reject);
          listener.listen(0, '127.0.0.1', () => {
            if (generation !== version) { listener.close(); reject(fail(409, 'The selected video changed.')); return; }
            listener.unref(); resolve('http://127.0.0.1:' + listener.address().port + secret);
          });
        });
      }
      input = await bridgeReady;
    } else {
      const item = file();
      if (!item?.path || item.version !== version) throw fail(409, 'The selected video changed.');
      input = item.path;
    }
    const matroska = ['.mkv', '.webm'].includes(path.extname(peer ? String(asset().name || 'video.mp4') : input).toLowerCase());
    return ['-protocol_whitelist', peer ? 'http,tcp' : 'file', '-format_whitelist', matroska ? 'matroska' : 'mov',
      '-f', matroska ? 'matroska' : 'mov', ...(matroska ? [] : ['-enable_drefs', '0', '-use_absolute_path', '0']), '-i', input];
  }
  async function execute(tool, args, timeout, maxBuffer = 2 * 1024 * 1024) {
    if (active >= 3) throw fail(503, 'Track preparation is busy. Try again shortly.');
    active++;
    const signal = controller.signal;
    try {
      const local = path.join(__dirname, 'tools', tool + (process.platform === 'win32' ? '.exe' : ''));
      const result = await run(fs.existsSync(local) ? local : tool, args, { windowsHide: true, timeout, maxBuffer, signal });
      signal.throwIfAborted();
      return result.stdout;
    } catch (error) {
      if (signal.aborted) throw fail(409, 'The selected video changed.');
      throw fail(503, error.code === 'ENOENT' ? 'Media tools are unavailable on this server.' : 'This track could not be prepared.');
    } finally { active--; }
  }
  async function tracks() {
    const input = await source();
    if (!listing) {
      const generation = version;
      listing = execute('ffprobe', ['-v', 'error', ...input, '-show_streams', '-of', 'json'], 20000).then(text => {
        if (generation !== version) throw fail(409, 'The video changed.');
        const streams = JSON.parse(text).streams || [];
        return {
          audio: streams.filter(s => s.codec_type === 'audio').slice(0, 32).map((s, n) => ({ id: s.index, label: label(s, n), codec: s.codec_name })),
          captions: streams.filter(s => s.codec_type === 'subtitle').slice(0, 32).map((s, n) => ({
            id: s.index, label: label(s, n), supported: ['subrip', 'webvtt', 'ass', 'ssa', 'mov_text', 'text'].includes(s.codec_name),
          })),
        };
      }).catch(error => { if (generation === version) listing = undefined; throw error; });
    }
    return listing;
  }
  async function audio(id, position = 0) {
    sync();
    const start = audioStart(position);
    if (!(await tracks()).audio.some(track => track.id === id)) throw fail(400, 'Choose an available audio track.');
    const key = version + ':audio:' + id + ':' + start;
    if (!pending.has(key)) {
      const signal = controller.signal;
      const base = asset().source === 'peer' ? path.join(directory, 'tracks-' + createHash('sha256').update(version).digest('hex')) : file().path;
      fs.mkdirSync(path.dirname(base), { recursive: true });
      const destination = base + '.track-' + id + (start ? '.part-' + start : '') + '.m4a';
      outputs.add(destination);
      const operation = (async () => {
        const input = await source();
        signal.throwIfAborted();
        if (fs.existsSync(destination)) return destination;
        const temporary = destination + '.tmp';
        const limit = 64 * 1024 * 1024;
        const release = cacheBudget.reserve(temporary, limit);
        try {
          const info = (await tracks()).audio.find(t => t.id === id);
          // Seek close to the window before reading. The output seek removes
          // negative-time preroll retained by stream copying sparse keyframes.
          await execute('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...(start ? ['-ss', String(start)] : []), ...input, ...(start ? ['-ss', '0'] : []), '-map', '0:' + id, '-vn', '-t', String(AUDIO_WINDOW_SECONDS),
            '-c:a', info.codec === 'aac' ? 'copy' : 'aac', ...(info.codec === 'aac' ? [] : ['-b:a', '320k']),
            '-fs', String(limit), '-movflags', '+faststart', '-f', 'mp4', temporary], 120000);
          signal.throwIfAborted();
          if (fs.statSync(temporary).size >= limit) throw fail(413, 'This audio track exceeds the preparation limit.');
          await fs.promises.rename(temporary, destination);
          return destination;
        } finally { release(); await fs.promises.unlink(temporary).catch(() => {}); }
      })();
      pending.set(key, operation);
      operation.catch(() => { if (pending.get(key) === operation) pending.delete(key); });
    }
    return pending.get(key);
  }
  async function captions(id) {
    sync();
    if (id === 'uploaded') {
      if (!uploaded) throw fail(404, 'Upload a caption file first.');
      return uploaded;
    }
    const index = Number(id);
    const track = (await tracks()).captions.find(t => t.id === index);
    if (!track?.supported) throw fail(400, 'This subtitle track is image-based. Add an SRT or WebVTT file.');
    const key = version + ':captions:' + index;
    if (!pending.has(key)) {
      const operation = execute('ffmpeg', ['-nostdin', '-v', 'error', ...await source(), '-map', '0:' + index, '-f', 'webvtt', '-'], 30000).then(parse);
      pending.set(key, operation);
      operation.catch(() => { if (pending.get(key) === operation) pending.delete(key); });
    }
    return pending.get(key);
  }
  async function select(body) {
    sync();
    const generation = version;
    if (body.version !== generation || !generation) throw fail(409, 'The selected video changed.');
    const next = { ...options };
    for (const name of ['size', 'x', 'y', 'width']) {
      if (body[name] === undefined) continue;
      const ranges = { size: [12, 96], x: [0, 100], y: [0, 100], width: [20, 100] };
      if (!Number.isFinite(body[name]) || body[name] < ranges[name][0] || body[name] > ranges[name][1]) throw fail(400, 'Invalid caption placement.');
      next[name] = body[name];
    }
    if (body.audio !== undefined) {
      if (typeof body.audio === 'string' && /^native:(?:[0-9]|[12][0-9]|3[01])$/.test(body.audio)) {
        if (asset()?.source !== 'peer') throw fail(400, 'Choose an available audio track.');
      } else if (body.audio !== null) await audio(body.audio, body.position ?? 0);
      next.audio = body.audio;
    }
    if (body.captions !== undefined) {
      if (body.captions !== 'off') await captions(body.captions);
      next.captions = body.captions;
    }
    if (version !== generation) throw fail(409, 'The selected video changed.');
    options = { ...options, ...Object.fromEntries(Object.keys(body).filter(key => ['audio', 'captions', 'size', 'x', 'y', 'width'].includes(key)).map(key => [key, next[key]])) };
    changed();
    return options;
  }
  async function upload(req, v) {
    sync();
    const generation = version;
    if (v !== generation || !generation) throw fail(409, 'The video changed.');
    const chunks = []; let bytes = 0;
    const timer = setTimeout(() => req.destroy(), 15000); timer.unref();
    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) throw fail(413, 'Caption file must be 2 MB or smaller.');
        chunks.push(chunk);
      }
      const cues = parse(Buffer.concat(chunks).toString('utf8'));
      if (version !== generation) throw fail(409, 'The video changed.');
      uploaded = cues; options.captions = 'uploaded'; options.captionRevision++; changed();
    } finally { clearTimeout(timer); }
  }
  return { sync, tracks, select, upload, captions, reset,
    async serveAudio(req, res, id, position = 0) {
      const output = await audio(Number(id), Number(position));
      if (!res.destroyed) serveAsset(req, res, output, 'audio/mp4', false, { cacheControl: 'private, no-store' });
    } };
};
