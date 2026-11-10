
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const atomicJson = require('./atomic-json');
const serveAsset = require('./static-assets');

const FORMATS = {
  skippable: { max: 60, skipAfter: 5 },
  standard: { max: 15, skipAfter: null },
  bumper: { max: 6, skipAfter: null },
};
const LIMIT = 25 * 1024 * 1024;
const LOGO_LIMIT = 2 * 1024 * 1024;
const CREATIVE_LIMIT = 20;
const SESSION_MS = 4 * 60 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const DEFAULT_ADVERTISER_FORM = 'https://forms.gle/x32An3oiyoXfxjiT7';
const TRIM_PRESETS = { 6: 6, 15: 15, 30: 30, 60: 60 };
const cookieName = 'cinewall_ads';
const run = promisify(execFile);
const fail = (status, message) => Object.assign(new Error(message), { status });

function formLink(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    if (!url.username && !url.password && (url.protocol === 'https:' || url.protocol === 'http:')) return url.href;
  } catch {}
  throw fail(400, 'Enter a valid HTTP or HTTPS URL.');
}

async function inspectVideo(file) {
  let info;
  try {
    const { stdout } = await run(process.env.CINEWALL_FFPROBE || 'ffprobe',
      ['-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', 'mov', '-show_format', '-show_streams', '-of', 'json', file],
      { timeout: 15000, maxBuffer: 512 * 1024, windowsHide: true });
    info = JSON.parse(stdout);
  } catch (error) {
    if (error.code === 'ENOENT') throw fail(503, 'Video validation is unavailable on this server.');
    throw fail(400, 'The uploaded file could not be read as an MP4 video.');
  }
  const video = info.streams?.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  const audio = info.streams?.filter(stream => stream.codec_type === 'audio') || [];
  const duration = Math.max(Number(info.format?.duration), Number(video?.duration) || 0,
    ...audio.map(stream => Number(stream.duration) || 0));
  if (!info.format?.format_name?.split(',').includes('mp4') || video?.codec_name !== 'h264'
    || !['yuv420p', 'yuvj420p'].includes(video.pix_fmt)
    || audio.some(stream => stream.codec_name !== 'aac') || !Number.isFinite(duration)
    || duration < .5 || duration > FORMATS.skippable.max) {
    throw fail(400, 'Upload a 0.5–60 second H.264 MP4 with AAC audio or no audio.');
  }
  const width = Number(video.width) || 0;
  const height = Number(video.height) || 0;
  return { duration: Math.ceil(duration * 1000) / 1000, width, height };
}

async function trimVideo(inputPath, outputPath, startTime, duration) {
  try {
    await run(process.env.CINEWALL_FFMPEG || 'ffmpeg',
      ['-y', '-i', inputPath, '-ss', String(startTime), '-t', String(duration), 
       '-c', 'copy', '-avoid_negative_ts', 'make_zero', outputPath],
      { timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true });
  } catch (error) {
    if (error.code === 'ENOENT') throw fail(503, 'Video trimming is unavailable. Install ffmpeg.');
    throw fail(400, 'Video trimming failed: ' + (error.message || 'Unknown error'));
  }
}

function createAdvertising({ root, password = process.env.CINEWALL_ADS_PASSWORD,
  fallbackForm = process.env.CINEWALL_ADS_FORM_URL, inspect = inspectVideo, now = Date.now } = {}) {
  const directory = path.join(root, 'advertising');
  const manifest = path.join(directory, 'settings.json');
  const sessions = new Map();
  const attempts = new Map();
  const digest = value => createHash('sha256').update(value).digest();
  const passwordHash = password ? digest(password) : null;
  let incoming = false;
  let configuredForm = DEFAULT_ADVERTISER_FORM;
  try { configuredForm = formLink(fallbackForm) || configuredForm; } catch {}
  let data = { enabled: false, formUrl: configuredForm, creatives: [], slots: [], logo: null };
  try { data = { ...data, ...JSON.parse(fs.readFileSync(manifest, 'utf8')) }; } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  data.formUrl ||= configuredForm;
  const fileFor = id => path.join(directory, id + '.mp4');
  const logoFileFor = id => path.join(directory, 'logo-' + id);
  const getCreative = id => data.creatives.find(creative => creative.id === id);
  const save = next => {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    atomicJson(manifest, next);
    data = next;
  };
  const secure = req => req.socket.encrypted || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.headers.host || '');
  const cookie = (req, value, seconds) => cookieName + '=' + value +
    '; Path=/advt; HttpOnly; SameSite=Strict; Max-Age=' + seconds + (secure(req) ? '; Secure' : '');
  function key(req) {
    return /(?:^|;\s*)cinewall_ads=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  }
  function signedIn(req) {
    const token = key(req);
    if ((sessions.get(token) || 0) > now()) return true;
    sessions.delete(token);
    return false;
  }
  function sameOrigin(req) {
    try {
      const origin = new URL(req.headers.origin);
      return origin.host === req.headers.host && origin.protocol === (secure(req) ? 'https:' : 'http:');
    } catch { return false; }
  }
  function resetExpired(map) {
    for (const [id, entry] of map) if ((entry.until ?? entry) <= now()) map.delete(id);
  }
  function signIn(req, res, body, json) {
    if (!passwordHash) throw fail(503, 'Advertising administration is disabled on this server.');
    resetExpired(attempts);
    resetExpired(sessions);
    // A proxy may share one socket address. Use a global ceiling too so a
    // four-digit password cannot be brute forced by rotating source addresses.
    const scopes = ['global', req.socket.remoteAddress || 'unknown'];
    const limits = [12, 5];
    if (scopes.some((id, index) => (attempts.get(id)?.count || 0) >= limits[index])) {
      res.setHeader('Retry-After', String(LOCKOUT_MS / 1000));
      throw fail(429, 'Too many attempts. Try again in 15 minutes.');
    }
    const supplied = typeof body?.password === 'string' ? body.password : '';
    if (!supplied || supplied.length > 256 || !timingSafeEqual(digest(supplied), passwordHash)) {
      for (const id of scopes) {
        const attempt = attempts.get(id) || { count: 0, until: now() + LOCKOUT_MS };
        attempt.count++;
        attempts.set(id, attempt);
      }
      throw fail(401, 'Incorrect password.');
    }
    if (sessions.size >= 64) sessions.delete(sessions.keys().next().value);
    sessions.delete(key(req));
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, now() + SESSION_MS);
    res.setHeader('Set-Cookie', cookie(req, token, SESSION_MS / 1000));
    json(res, 200, { ok: true });
  }

  async function upload(req, title, description) {
    if (incoming) throw fail(409, 'Wait for the current upload to finish.');
    if (data.creatives.length >= CREATIVE_LIMIT) throw fail(409, 'Remove an unused video before adding another.');
    if (req.headers['content-type'] !== 'video/mp4') throw fail(415, 'Choose an MP4 file.');
    const length = Number(req.headers['content-length']);
    if (!Number.isSafeInteger(length) || length < 1) throw fail(411, 'Upload a file with a known size.');
    if (length > LIMIT) throw fail(413, 'Ad videos must be 25 MiB or smaller.');
    title = String(title || '').trim();
    if (!title || title.length > 80) throw fail(400, 'Enter an ad name of up to 80 characters.');
    description = String(description || '').trim();
    if (description && description.length > 200) throw fail(400, 'Description must be 200 characters or less.');
    const id = randomUUID();
    const destination = fileFor(id);
    incoming = true;
    let size = 0;
    let committed = false;
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const limit = new Transform({ transform(chunk, _, done) {
        size += chunk.length;
        done(size > LIMIT ? fail(413, 'Ad videos must be 25 MiB or smaller.') : null, chunk);
      } });
      // Detach the HTTP input from the output pipeline so a file-write error
      // can still return a JSON response.
      req.pipe(limit);
      const abort = () => limit.destroy(fail(400, 'Upload interrupted.'));
      req.once('aborted', abort);
      req.once('error', abort);
      if (req.aborted) abort();
      try { await pipeline(limit, fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 })); }
      finally { req.off('aborted', abort); req.off('error', abort); req.unpipe(limit); }
      if (size !== length || req.aborted) throw fail(400, 'Upload interrupted.');
      const { duration, width, height } = await inspect(destination);
      const creative = { id, title, description, duration, originalDuration: duration, width, height, size, trimStart: 0, trimEnd: duration };
      save({ ...data, creatives: [...data.creatives, creative] });
      committed = true;
      return creative;
    } finally {
      incoming = false;
      if (!committed) await fs.promises.unlink(destination).catch(() => {});
    }
  }

  function configure(body) {
    if (!Array.isArray(body?.slots) || body.slots.length > 3 || typeof body.enabled !== 'boolean') {
      throw fail(400, 'Choose up to three ad slots.');
    }
    const slots = body.slots.map(slot => {
      const creative = getCreative(slot?.creativeId);
      const format = Object.hasOwn(FORMATS, slot?.format) && FORMATS[slot.format];
      if (!creative || !format) throw fail(400, 'Choose a video and format for every active slot.');
      if (creative.duration > format.max) throw fail(400, creative.title + ' is too long for this format (max ' + format.max + 's).');
      if (format.skipAfter !== null && creative.duration <= format.skipAfter) throw fail(400, 'A skippable video must be longer than 5 seconds.');
      return { creativeId: creative.id, format: slot.format };
    });
    if (body.enabled && !slots.length) throw fail(400, 'Add at least one slot before enabling ads.');
    save({ ...data, enabled: body.enabled, slots, formUrl: formLink(body.formUrl) || configuredForm });
  }

  function serve(req, res, id) {
    if (!getCreative(id)) throw fail(404, 'Ad video not found.');
    serveAsset(req, res, fileFor(id), 'video/mp4', false, { cacheControl: 'private, no-store' });
  }

  async function handle(req, res, url, { json, bodyJson, page }) {
    const route = url.pathname.replace(/\/$/, '');
    if (route === '/advertise' && ['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(302, { Location: data.formUrl, 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }
    if (route !== '/advt' && !route.startsWith('/advt/')) return false;
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (route === '/advt' && ['GET', 'HEAD'].includes(req.method)) {
      page(signedIn(req) ? 'dashboard.html' : 'login.html');
      return true;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) throw fail(403, 'Open the ads dashboard directly.');
    if (route === '/advt/api/login' && req.method === 'POST') {
      signIn(req, res, await bodyJson(req), json);
      return true;
    }
    if (!signedIn(req)) throw fail(401, 'Unlock the ads dashboard first.');
    if (route === '/advt/api/logout' && req.method === 'POST') {
      sessions.delete(key(req));
      res.setHeader('Set-Cookie', cookie(req, '', 0));
      json(res, 200, { ok: true });
    } else if (route === '/advt/api/settings' && req.method === 'GET') json(res, 200, data);
    else if (route === '/advt/api/settings' && req.method === 'POST') {
      configure(await bodyJson(req));
      json(res, 200, data);
    } else if (route === '/advt/api/creative' && req.method === 'POST') {
      await upload(req, url.searchParams.get('title'), url.searchParams.get('description'));
      json(res, 201, data);
    } else if (route.startsWith('/advt/api/creative/') && route.endsWith('/trim') && req.method === 'POST') {
      const id = route.split('/').at(-2);
      const creative = getCreative(id);
      if (!creative) throw fail(404, 'Ad video not found.');
      const body = await bodyJson(req);
      const targetDuration = Number(body.duration);
      const startTime = Number(body.startTime) || 0;
      if (!TRIM_PRESETS[targetDuration] && targetDuration !== creative.originalDuration) throw fail(400, 'Invalid trim duration.');
      if (startTime < 0 || startTime + targetDuration > creative.originalDuration) throw fail(400, 'Invalid trim range.');
      
      const tempFile = fileFor(id + '-trim');
      await trimVideo(fileFor(id), tempFile, startTime, targetDuration);
      await fs.promises.rename(tempFile, fileFor(id));
      
      creative.duration = targetDuration;
      creative.trimStart = startTime;
      creative.trimEnd = startTime + targetDuration;
      save(data);
      json(res, 200, data);
    } else if (route === '/advt/api/logo' && req.method === 'POST') {
      if (incoming) throw fail(409, 'Wait for the current upload to finish.');
      if (req.headers['content-type']?.startsWith('image/') === false) throw fail(415, 'Upload a PNG, JPG, or WebP image.');
      const length = Number(req.headers['content-length']);
      if (!Number.isSafeInteger(length) || length < 1) throw fail(411, 'Upload a file with a known size.');
      if (length > LOGO_LIMIT) throw fail(413, 'Logo must be 2 MiB or smaller.');
      
      const ext = req.headers['content-type'].split('/')[1]?.split(';')[0] || 'png';
      if (!['png', 'jpeg', 'jpg', 'webp'].includes(ext)) throw fail(415, 'Upload PNG, JPG, or WebP only.');
      
      const id = randomUUID();
      const logoPath = logoFileFor(id + '.' + ext);
      incoming = true;
      let committed = false;
      try {
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        await pipeline(req, fs.createWriteStream(logoPath, { flags: 'wx', mode: 0o600 }));
        
        // Delete old logo if exists
        if (data.logo) await fs.promises.unlink(logoFileFor(data.logo)).catch(() => {});
        
        data.logo = id + '.' + ext;
        save(data);
        committed = true;
        json(res, 200, data);
      } finally {
        incoming = false;
        if (!committed) await fs.promises.unlink(logoPath).catch(() => {});
      }
    } else if (route === '/advt/api/logo' && req.method === 'DELETE') {
      if (data.logo) {
        await fs.promises.unlink(logoFileFor(data.logo)).catch(() => {});
        data.logo = null;
        save(data);
      }
      json(res, 200, data);
    } else if (route === '/advt/api/logo' && ['GET', 'HEAD'].includes(req.method)) {
      if (!data.logo) throw fail(404, 'No logo uploaded.');
      const logoPath = logoFileFor(data.logo);
      const ext = data.logo.split('.').pop();
      const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      serveAsset(req, res, logoPath, contentType, false, { cacheControl: 'private, no-store' });
    } else if (route.startsWith('/advt/api/creative/') && req.method === 'DELETE') {
      const id = route.split('/').at(-1);
      if (!getCreative(id)) throw fail(404, 'Ad video not found.');
      if (data.slots.some(slot => slot.creativeId === id)) throw fail(409, 'Remove this video from the slots and save before deleting it.');
      save({ ...data, creatives: data.creatives.filter(creative => creative.id !== id) });
      await fs.promises.unlink(fileFor(id)).catch(() => {});
      json(res, 200, data);
    } else if (route.startsWith('/advt/api/media/') && ['GET', 'HEAD'].includes(req.method)) {
      serve(req, res, route.split('/').at(-1));
    } else throw fail(404, 'Ads route not found.');
    return true;
  }

  function campaign() {
    if (!data.enabled) return [];
    const logo = data.logo ? '/advt/api/logo' : null;
    return data.slots.flatMap(slot => {
      const creative = getCreative(slot.creativeId);
      return creative && fs.existsSync(fileFor(creative.id)) ? [{ ...creative, ...FORMATS[slot.format], logo }] : [];
    });
  }
  return { handle, campaign, serve };
}
module.exports = { createAdvertising, FORMATS, formLink };

