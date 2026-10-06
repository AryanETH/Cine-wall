'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { execFile } = require('node:child_process');
const downloads = require('./youtube-downloads');
const SERVER_ID = require('node:crypto').randomUUID();

const PREFERRED_PORT = Number(process.env.PORT || 4173);
const MAX_PORT_ATTEMPTS = 20;
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const CACHE_ROOT = path.resolve(process.env.CINEWALL_CACHE_DIR || path.join(__dirname, '.cinema-cache'));
const OFFICE_CONVERTER = path.join(__dirname, 'convert-office.ps1');
const MAX_JSON_BODY = 128 * 1024;
const MAX_ASSET_SIZE = 50 * 1024 * 1024 * 1024;
let activePort = PREFERRED_PORT;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ttf': 'font/ttf',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.htm': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
};

function createSession(room = '') {
const CACHE_DIR = room ? path.join(CACHE_ROOT, 'rooms', room) : CACHE_ROOT;
const SESSION_FILE = path.join(CACHE_DIR, 'session.json');
const validExtensions = {
  video: new Set(['.mp4', '.webm', '.m4v', '.mkv']),
  audio: new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.flac', '.webm']),
  presentation: new Set(['.pdf', '.ppt', '.pptx', '.pps', '.ppsx', '.odp', '.doc', '.docx', '.rtf', '.png', '.jpg', '.jpeg', '.webp', '.gif']),
};
const officeExtensions = new Set(['.ppt', '.pptx', '.pps', '.ppsx', '.odp', '.doc', '.docx', '.rtf']);
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const viewers = new Set();
const screens = new Map();
let commandSequence = 0;
let assetFile = null;
let uploadInProgress = false;
let preparation = null;
let preparationController = null;
let sourceOwner = null;
const relayRequests = new Map();

function defaultAudioSettings(all = false) {
  return Object.fromEntries(Array.from({ length: 5 }, (_, index) => [String(index + 1), { volume: 1, muted: !all && index > 0 }]));
}

let state = {
  sessionMode: 'video',
  playing: false,
  loop: false,
  position: 0,
  anchorTime: Date.now(),
  mode: 'stretch',
  screenCount: 2,
  audioMode: 'personal',
  audioSettings: defaultAudioSettings(true),
  youtubeAudioMode: 'admin',
  asset: null,
  page: 1,
  notBefore: 0,
  commandId: 0,
};

fs.mkdirSync(CACHE_DIR, { recursive: true });

// Keep the selected movie across server restarts so joined Devices can recover.
try {
  const saved = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  const savedPath = saved.assetFile && path.resolve(saved.assetFile.path);
  if (saved.state && ['video', 'audio', 'presentation', 'youtube'].includes(saved.state.sessionMode)
      && (!savedPath || savedPath.startsWith(`${CACHE_DIR}${path.sep}`) && fs.existsSync(savedPath))) {
    state = { ...state, ...saved.state, playing: false, notBefore: 0, anchorTime: Date.now() };
    if (!['personal', '3d'].includes(state.audioMode)) state.audioMode = 'personal';
    assetFile = saved.assetFile;
    commandSequence = Number(state.commandId) || 0;
    sourceOwner = saved.sourceOwner || null;
    // An in-browser source cannot survive a server/browser restart.
    if (state.asset?.source === 'peer') { state.asset = null; sourceOwner = null; }
  }
} catch {}

function saveSession() {
  try { fs.writeFileSync(SESSION_FILE, JSON.stringify({ state: snapshot(), assetFile, sourceOwner }), 'utf8'); } catch {}
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BODY) {
        reject(new Error('Request is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function currentPosition(at = Date.now()) {
  if (!state.playing) return state.position;
  return Math.max(0, state.position + Math.max(0, at - state.anchorTime) / 1000);
}

function snapshot() {
  return { ...state, ownerId: sourceOwner?.id || '', roomId: room || 'hotspot', allReady: allDisplaysReady(), preparation, serverId: SERVER_ID, serverTime: Date.now() };
}

function identity(req) {
  const id = String(req.headers['x-cinewall-device'] || '');
  const token = String(req.headers['x-cinewall-key'] || '');
  if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9-]{36}$/.test(token)) {
    const error = new Error('Reload CineWall to join this room.'); error.status = 401; throw error;
  }
  return { id, hash: require('node:crypto').createHash('sha256').update(token).digest('hex') };
}

function checkOwner(req, claim = false) {
  if (sourceOwner && !state.asset && !uploadInProgress && Date.now() - sourceOwner.claimedAt > 60000) sourceOwner = null;
  const device = identity(req);
  if (sourceOwner && (sourceOwner.id !== device.id || sourceOwner.hash !== device.hash)) {
    const error = new Error('Another laptop is the admin. Wait until it removes the file.'); error.status = 423; throw error;
  }
  if (!sourceOwner && claim) {
    sourceOwner = { ...device, claimedAt: Date.now() }; saveSession(); broadcast('state', snapshot());
  }
  return device;
}

function releaseReservation() {
  if (!state.asset && !uploadInProgress) { sourceOwner = null; saveSession(); broadcast('state', snapshot()); }
}

function allDisplaysReady() {
  if (!state.asset || uploadInProgress) return false;
  const joined = activeScreens();
  for (let number = 1; number <= state.screenCount; number++) {
    const latest = joined.filter((screen) => screen.screen === number).sort((a, b) => b.lastSeen - a.lastSeen)[0];
    if (!latest?.ready || !latest.mediaReady || latest.assetVersion !== state.asset.version || latest.error || latest.buffering) return false;
  }
  return true;
}

function sendEvent(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(event, payload) {
  for (const client of viewers) {
    try {
      sendEvent(client, event, payload);
    } catch {
      viewers.delete(client);
    }
  }
}

function modeLimits(sessionMode = state.sessionMode) {
  if (sessionMode === 'audio') return { min: 1, max: 5, initial: 1 };
  if (sessionMode === 'presentation') return { min: 1, max: 3, initial: 1 };
  return { min: 1, max: 3, initial: 2 };
}

function extractYouTubeId(value) {
  const input = String(value || '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new Error('Paste a valid YouTube link');
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  let candidate = '';
  if (host === 'youtu.be') candidate = url.pathname.split('/').filter(Boolean)[0] || '';
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') candidate = url.searchParams.get('v') || '';
    else {
      const parts = url.pathname.split('/').filter(Boolean);
      if (['shorts', 'embed', 'live'].includes(parts[0])) candidate = parts[1] || '';
    }
  }
  if (!/^[a-zA-Z0-9_-]{11}$/.test(candidate)) throw new Error('This YouTube link does not contain a valid video ID');
  return candidate;
}

function audioSettingsForMode(sessionMode) {
  const settings = defaultAudioSettings(['video', 'audio'].includes(sessionMode));
  if (sessionMode === 'presentation') for (const setting of Object.values(settings)) setting.muted = true;
  return settings;
}

function removeCurrentAsset() {
  for (const request of relayRequests.values()) request.reject(new Error('The selected file changed.'));
  const oldPath = assetFile?.path;
  assetFile = null;
  if (oldPath) fs.unlink(oldPath, () => {});
}

function applyCommand(input) {
  const now = Date.now();
  // Give every ready browser time to receive the same start, rather than
  // starting the source first. Mixer changes remain immediate.
  const executeAt = now + (['screen-audio', 'mute-all', 'audio-mode', 'youtube-audio-mode', 'audio-output'].includes(input.type) ? 0 : input.type === 'play' ? 350 : 90);
  const type = String(input.type || '');
  let position = currentPosition(executeAt);

  if (type === 'session-mode') {
    const sessionMode = String(input.sessionMode || '');
    if (!['video', 'audio', 'presentation', 'youtube'].includes(sessionMode)) throw new Error('Unknown session mode');
    if (sessionMode !== state.sessionMode) {
      if (uploadInProgress) throw new Error('Wait for the current file to finish preparing, or cancel it first');
      removeCurrentAsset();
      sourceOwner = null;
      const limits = modeLimits(sessionMode);
      state = {
        ...state,
        sessionMode,
        playing: false,
        position: 0,
        anchorTime: executeAt,
        screenCount: limits.initial,
        audioMode: 'personal',
        mode: sessionMode === 'presentation' || sessionMode === 'youtube' ? 'crop' : sessionMode === 'video' ? 'stretch' : state.mode,
        audioSettings: audioSettingsForMode(sessionMode),
        youtubeAudioMode: 'admin',
        asset: null,
        page: 1,
      };
      screens.clear();
    }
  } else if (type === 'clear-asset') {
    if (uploadInProgress) throw new Error('Wait for the current file to finish preparing before removing it');
    if (input.assetVersion && state.asset && input.assetVersion !== state.asset.version) throw new Error('The loaded file changed. Remove the current file instead');
    removeCurrentAsset();
    sourceOwner = null;
    state = { ...state, asset: null, playing: false, position: 0, page: 1, anchorTime: executeAt };
    for (const screen of screens.values()) {
      Object.assign(screen, { mediaReady: false, duration: 0, playbackTime: 0, fileName: '', paused: true, buffering: false, error: '' });
    }
  } else if (type === 'load-youtube') {
    if (state.sessionMode !== 'youtube') throw new Error('Switch the dashboard to YouTube mode first');
    const videoId = extractYouTubeId(input.url);
    removeCurrentAsset();
    const version = `youtube-${videoId}-${Date.now()}`;
    state = {
      ...state,
      playing: false,
      position: 0,
      anchorTime: executeAt,
      asset: {
        kind: 'youtube', renderType: 'youtube', videoId, version, size: 0,
        name: `YouTube · ${videoId}`,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      },
    };
    for (const screen of screens.values()) {
      screen.mediaReady = false;
      screen.duration = 0;
      screen.playbackTime = 0;
      screen.error = '';
    }
  } else if (type === 'play') {
    if (!state.asset || !['video', 'audio', 'youtube'].includes(state.sessionMode)) throw new Error('Choose a video, audio file, or YouTube link first');
    if (!allDisplaysReady()) { const error = new Error('Wait until every display is ready.'); error.status = 409; throw error; }
    if (Number.isFinite(input.position)) position = Math.max(0, Number(input.position));
    state = { ...state, playing: true, position, anchorTime: executeAt };
  } else if (type === 'pause') {
    state = { ...state, playing: false, position, anchorTime: executeAt };
  } else if (type === 'seek') {
    if (!['video', 'audio', 'youtube'].includes(state.sessionMode)) throw new Error('Seeking is only available for video, audio, and YouTube');
    position = Math.max(0, Number(input.position) || 0);
    state = { ...state, position, anchorTime: executeAt };
  } else if (type === 'restart') {
    state = { ...state, position: 0, anchorTime: executeAt };
  } else if (type === 'loop') {
    if (!['video', 'audio', 'youtube'].includes(state.sessionMode)) throw new Error('Loop is only available for media');
    state = { ...state, loop: Boolean(input.loop) };
  } else if (type === 'mode') {
    if (!['fit', 'crop', 'stretch'].includes(input.mode)) throw new Error('Unknown wall framing');
    if (['presentation', 'youtube'].includes(state.sessionMode) && input.mode === 'stretch') throw new Error('Stretch is not available in this mode');
    state = { ...state, mode: input.mode };
  } else if (type === 'audio-mode') {
    if (!['video', 'audio'].includes(state.sessionMode)) throw new Error('3D mode is only available for video and audio');
    if (!['personal', '3d'].includes(input.audioMode)) throw new Error('Unknown sound mode');
    state = { ...state, audioMode: input.audioMode };
  } else if (type === 'layout') {
    const screenCount = Number(input.screenCount);
    const limits = modeLimits();
    if (!Number.isInteger(screenCount) || screenCount < limits.min || screenCount > limits.max) {
      throw new Error(`This mode supports ${limits.min} to ${limits.max} screens`);
    }
    const audioSettings = { ...state.audioSettings };
    if (screenCount > state.screenCount && ['video', 'audio'].includes(state.sessionMode)) {
      for (let screen = state.screenCount + 1; screen <= screenCount; screen++) audioSettings[String(screen)] = { volume: 1, muted: false };
    }
    state = { ...state, screenCount, audioSettings };
  } else if (type === 'screen-audio') {
    const screen = Number(input.screen);
    if (!Number.isInteger(screen) || screen < 1 || screen > 5) throw new Error('Unknown speaker');
    const previous = state.audioSettings[String(screen)] || { volume: 1, muted: false };
    const volume = Number.isFinite(Number(input.volume)) ? Math.min(1, Math.max(0, Number(input.volume))) : previous.volume;
    const muted = typeof input.muted === 'boolean' ? input.muted : previous.muted;
    state = {
      ...state,
      audioSettings: { ...state.audioSettings, [String(screen)]: { volume, muted } },
    };
  } else if (type === 'mute-all') {
    const muted = Boolean(input.muted);
    state = {
      ...state,
      audioSettings: Object.fromEntries(Object.entries(state.audioSettings).map(([screen, setting]) => [screen, { ...setting, muted }])),
    };
  } else if (type === 'youtube-audio-mode' || type === 'audio-output') {
    if (!['video', 'audio', 'youtube'].includes(state.sessionMode) || type === 'youtube-audio-mode' && state.sessionMode !== 'youtube') throw new Error('Audio output is unavailable in this mode');
    const youtubeAudioMode = (type === 'audio-output' ? input.output : input.youtubeAudioMode) === 'all' ? 'all' : 'admin';
    state = {
      ...state,
      youtubeAudioMode,
      audioSettings: Object.fromEntries(Object.entries(state.audioSettings).map(([screen, setting]) => [
        screen,
        { ...setting, muted: youtubeAudioMode === 'admin' ? Number(screen) !== 1 : false },
      ])),
    };
  } else if (type === 'page') {
    if (state.sessionMode !== 'presentation' || !state.asset) throw new Error('Choose a presentation first');
    const maximum = state.asset.pageCount || 999;
    const page = Math.min(maximum, Math.max(1, Math.round(Number(input.page) || 1)));
    state = { ...state, page };
  } else if (type === 'next-page' || type === 'previous-page') {
    if (state.sessionMode !== 'presentation' || !state.asset) throw new Error('Choose a presentation first');
    const maximum = state.asset.pageCount || 999;
    const page = type === 'next-page' ? Math.min(maximum, state.page + 1) : Math.max(1, state.page - 1);
    state = { ...state, page };
  } else if (type === 'identify') {
    // Visual-only command.
  } else {
    throw new Error('Unknown command');
  }

  state.notBefore = executeAt;
  state.commandId = ++commandSequence;
  const command = { type, executeAt, ...snapshot(), serverTime: now };
  broadcast('command', command);
  broadcast('state', snapshot());
  saveSession();
  return command;
}

function networkDetails() {
  const addresses = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const normalized = name.toLowerCase();
      const isHotspot = entry.address === '192.168.137.1' || normalized.includes('local area connection*');
      const isPhysicalWifi = normalized === 'wi-fi' || normalized === 'wifi';
      addresses.push({ address: entry.address, name, isHotspot, rank: isPhysicalWifi ? 0 : isHotspot ? 2 : 1 });
    }
  }
  addresses.sort((a, b) => a.rank - b.rank || a.address.localeCompare(b.address));
  return addresses.filter((item, index) => addresses.findIndex((candidate) => candidate.address === item.address) === index);
}

function activeScreens() {
  const cutoff = Date.now() - 20000;
  for (const [id, info] of screens) {
    if (info.lastSeen < cutoff) screens.delete(id);
  }
  return [...screens.values()].sort((a, b) => a.screen - b.screen || b.lastSeen - a.lastSeen);
}

function convertOfficeToPdf(inputPath, outputPath, extension) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', OFFICE_CONVERTER,
      '-InputPath', inputPath, '-OutputPath', outputPath, '-Extension', extension,
    ], { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || error.message || 'Office conversion failed').trim()));
        return;
      }
      resolve(stdout);
    });
  });
}

function countPdfPages(filePath, size) {
  if (size > 512 * 1024 * 1024) return 0;
  try {
    const source = fs.readFileSync(filePath).toString('latin1');
    const counts = [...source.matchAll(/\/Count\s+(\d+)/g)].map((match) => Number(match[1])).filter(Number.isFinite);
    if (counts.length) return Math.max(...counts);
    const pageObjects = source.match(/\/Type\s*\/Page\b/g);
    return pageObjects?.length || 0;
  } catch {
    return 0;
  }
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function decodeXml(value) {
  return String(value)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function unzipEntries(filePath) {
  const archive = fs.readFileSync(filePath);
  let end = -1;
  for (let index = archive.length - 22; index >= Math.max(0, archive.length - 65557); index -= 1) {
    if (archive.readUInt32LE(index) === 0x06054b50) { end = index; break; }
  }
  if (end < 0) throw new Error('The Office file is not a valid ZIP document');
  const entryCount = archive.readUInt16LE(end + 10);
  let offset = archive.readUInt32LE(end + 16);
  const entries = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) throw new Error('The Office ZIP directory is damaged');
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (archive.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('The Office ZIP entry is damaged');
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) entries.set(name, Buffer.from(compressed));
    else if (method === 8) entries.set(name, zlib.inflateRawSync(compressed));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function extractParagraphs(xml, prefix) {
  const paragraphPattern = new RegExp(`<${prefix}:p\\b[\\s\\S]*?<\\/${prefix}:p>`, 'g');
  const textPattern = new RegExp(`<${prefix}:t(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${prefix}:t>`, 'g');
  const paragraphs = [];
  for (const paragraph of xml.match(paragraphPattern) || []) {
    const pieces = [...paragraph.matchAll(textPattern)].map((match) => decodeXml(match[1]));
    const text = pieces.join(prefix === 'a' ? ' ' : '').replace(/\s+/g, ' ').trim();
    if (text) paragraphs.push(text);
  }
  return paragraphs;
}

function buildOfficeHtml(title, pages) {
  const safeTitle = htmlEscape(title);
  const pageMarkup = pages.map((paragraphs, pageIndex) => {
    const clean = paragraphs.filter(Boolean);
    const heading = clean[0] || `${safeTitle} · Page ${pageIndex + 1}`;
    const body = clean.slice(1).map((paragraph) => `<p>${htmlEscape(paragraph)}</p>`).join('');
    return `<section class="page" data-page="${pageIndex + 1}"><div class="paper"><span class="page-number">${pageIndex + 1}</span><h1>${htmlEscape(heading)}</h1>${body || '<p class="empty">No readable text on this page.</p>'}</div></section>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#070a10;color:#f8faf6;font-family:Segoe UI,Arial,sans-serif}.page{position:absolute;inset:0;display:none;place-items:center;padding:4vh}.page.active{display:grid}.paper{position:relative;width:92vw;height:88vh;padding:8vh 8vw;overflow:hidden;border:1px solid rgba(255,255,255,.12);border-radius:2vw;background:#111624;box-shadow:0 4vh 10vh rgba(0,0,0,.35)}h1{max-width:72vw;margin:0 0 5vh;color:#a8ff35;font-size:clamp(2.4rem,6vw,6rem);font-weight:560;letter-spacing:-.055em;line-height:.96}p{max-width:76vw;margin:1.2em 0;color:#d8dce5;font-size:clamp(1.05rem,2.2vw,2rem);line-height:1.45}.page-number{position:absolute;right:3vw;bottom:3vh;color:#747c8c;font-size:.8rem}.empty{color:#8f96a7}</style></head><body>${pageMarkup}<script>(()=>{const pages=[...document.querySelectorAll('.page')];function show(){const value=Math.max(1,Math.min(pages.length,parseInt(location.hash.replace(/\\D/g,''),10)||1));pages.forEach((page,index)=>page.classList.toggle('active',index===value-1))}addEventListener('hashchange',show);show()})()</script></body></html>`;
}

function renderOfficeFallback(inputPath, outputPath, extension, name) {
  let pages = [];
  if (extension === '.rtf') {
    const source = fs.readFileSync(inputPath, 'latin1');
    pages = source.split(/\\page\b/).map((part) => part
      .replace(/\\'([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\par[d]?\b/g, '\n').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '')
      .split(/\n+/).map((line) => line.trim()).filter(Boolean));
  } else {
    const entries = unzipEntries(inputPath);
    if (extension === '.pptx' || extension === '.ppsx') {
      const slides = [...entries.keys()].filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry)).sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
      pages = slides.map((entry) => extractParagraphs(entries.get(entry).toString('utf8'), 'a'));
    } else if (extension === '.docx') {
      const document = entries.get('word/document.xml');
      if (!document) throw new Error('The Word document has no readable document.xml');
      const paragraphs = extractParagraphs(document.toString('utf8'), 'w');
      for (let index = 0; index < paragraphs.length; index += 14) pages.push(paragraphs.slice(index, index + 14));
    } else if (extension === '.odp') {
      const content = entries.get('content.xml');
      if (!content) throw new Error('The OpenDocument presentation has no content.xml');
      const xml = content.toString('utf8');
      const slideXml = xml.match(/<draw:page\b[\s\S]*?<\/draw:page>/g) || [];
      pages = slideXml.map((slide) => [...slide.matchAll(/<text:p(?:\s[^>]*)?>([\s\S]*?)<\/text:p>/g)].map((match) => decodeXml(match[1].replace(/<[^>]+>/g, '')).trim()).filter(Boolean));
    } else {
      throw new Error('A full Office installation is required for this legacy file type');
    }
  }
  pages = pages.filter((page) => page.length);
  if (!pages.length) pages = [[name, 'No readable text was found. Save this file as PDF for full-fidelity presentation.']];
  fs.writeFileSync(outputPath, buildOfficeHtml(name, pages), 'utf8');
  return pages.length;
}

function mimeForAsset(kind, extension, requestType) {
  if (kind === 'video') return extension === '.mkv' ? 'video/x-matroska' : extension === '.webm' ? 'video/webm' : 'video/mp4';
  if (kind === 'audio') return ({ '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.flac': 'audio/flac', '.webm': 'audio/webm' })[extension] || (requestType.startsWith('audio/') ? requestType : 'audio/mpeg');
  if (extension === '.pdf') return 'application/pdf';
  if (imageExtensions.has(extension)) return contentTypes[extension] || requestType || 'image/jpeg';
  return requestType || 'application/octet-stream';
}

async function receiveAsset(req, res, url) {
  if (uploadInProgress) {
    json(res, 409, { error: 'A file is already being prepared. Follow its progress or cancel it first.', preparation });
    return;
  }

  const kind = String(url.searchParams.get('kind') || 'video');
  if (!['video', 'audio', 'presentation'].includes(kind)) {
    json(res, 400, { error: 'Unknown file mode' });
    return;
  }
  if (kind !== state.sessionMode) {
    json(res, 409, { error: `Switch the dashboard to ${kind} mode first` });
    return;
  }

  const size = Number(req.headers['content-length'] || 0);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_ASSET_SIZE) {
    json(res, 400, { error: 'File size is missing, empty, or larger than 50 GB' });
    return;
  }

  let name = `${kind}-file`;
  try { name = decodeURIComponent(url.searchParams.get('name') || name).slice(0, 220); } catch {}
  const extension = path.extname(name).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 12);
  if (!validExtensions[kind].has(extension)) {
    json(res, 415, { error: kind === 'video' ? 'This video cannot play in a browser. Use MP4 with H.264 video and AAC audio, or a supported WebM file.' : `This ${kind} file type is not supported` });
    return;
  }

  const requestType = String(req.headers['content-type'] || 'application/octet-stream');
  const version = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const temporaryPath = path.join(CACHE_DIR, `upload-${version}.tmp`);
  const rawPath = path.join(CACHE_DIR, `asset-${version}${extension}`);
  checkOwner(req, true);
  uploadInProgress = true;
  preparationController = new AbortController();
  const signal = preparationController.signal;
  preparation = { version, kind, name, size, phase: 'uploading', progress: 0, error: '', started: Date.now() };
  broadcast('state', snapshot());
  let received = 0;

  try {
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(temporaryPath, { flags: 'wx' });
      req.on('data', (chunk) => {
        received += chunk.length;
        preparation.progress = Math.min(100, received / size * 100);
        if (received > MAX_ASSET_SIZE) req.destroy(new Error('File is larger than 50 GB'));
      });
      req.on('aborted', () => reject(new Error('File transfer was interrupted')));
      req.on('error', reject);
      output.on('error', reject);
      output.on('finish', resolve);
      const abortUpload = () => { req.unpipe(output); output.destroy(new Error('Preparation cancelled')); req.resume(); };
      signal.addEventListener('abort', abortUpload, { once: true });
      output.on('close', () => signal.removeEventListener('abort', abortUpload));
      req.pipe(output);
    });

    if (received !== size) throw new Error('File transfer was incomplete');
    await fs.promises.rename(temporaryPath, rawPath);
    signal.throwIfAborted();
    preparation.phase = 'checking';
    preparation.progress = 0;
    broadcast('state', snapshot());

    let finalPath = rawPath;
    let finalType = mimeForAsset(kind, extension, requestType);
    let renderType = kind === 'presentation' ? (imageExtensions.has(extension) ? 'image' : 'pdf') : 'media';
    let converted = false;
    let lossless = false;
    let pageCount = 0;
    if (kind === 'video') await downloads.inspectBrowserVideo(rawPath, extension, { signal });

    if (kind === 'presentation' && officeExtensions.has(extension)) {
      const pdfPath = path.join(CACHE_DIR, `asset-${version}.pdf`);
      try {
        await convertOfficeToPdf(rawPath, pdfPath, extension);
        await fs.promises.unlink(rawPath).catch(() => {});
        finalPath = pdfPath;
        finalType = 'application/pdf';
        renderType = 'pdf';
        converted = true;
      } catch (error) {
        const htmlPath = path.join(CACHE_DIR, `asset-${version}.htm`);
        pageCount = renderOfficeFallback(rawPath, htmlPath, extension, name);
        await fs.promises.unlink(rawPath).catch(() => {});
        finalPath = htmlPath;
        finalType = 'text/html; charset=utf-8';
        renderType = 'html';
        converted = 'simplified';
      }
    }

    signal.throwIfAborted();
    if (state.sessionMode !== kind) throw new Error('The session mode changed during preparation');
    const finalSize = (await fs.promises.stat(finalPath)).size;
    if (!pageCount) pageCount = kind === 'presentation' && renderType === 'pdf' ? countPdfPages(finalPath, finalSize) : kind === 'presentation' ? 1 : 0;
    const previousPath = assetFile?.path;
    assetFile = { path: finalPath, name, size: finalSize, originalSize: size, type: finalType, version, kind, renderType, pageCount, converted, lossless };
    state = {
      ...state,
      playing: false,
      position: 0,
      anchorTime: Date.now(),
      page: 1,
      asset: { name, size: finalSize, originalSize: size, type: finalType, version, kind, renderType, pageCount, converted, lossless },
      commandId: ++commandSequence,
    };
    for (const screen of screens.values()) {
      screen.mediaReady = false;
      screen.duration = 0;
    }
    if (previousPath && previousPath !== finalPath) fs.unlink(previousPath, () => {});
    preparation.phase = 'ready';
    preparation.progress = 100;
    broadcast('state', snapshot());
    saveSession();
    json(res, 200, { ok: true, asset: state.asset, state: snapshot() });
  } catch (error) {
    await fs.promises.unlink(temporaryPath).catch(() => {});
    await fs.promises.unlink(rawPath).catch(() => {});
    preparation.phase = signal.aborted ? 'cancelled' : 'error';
    preparation.error = signal.aborted ? 'Preparation cancelled. You can choose another file.' : error.message || 'The file could not be prepared';
    broadcast('state', snapshot());
    if (!res.headersSent && !res.destroyed) json(res, signal.aborted ? 409 : kind === 'video' && /MP4|WebM|video track|audio track|browser/i.test(preparation.error) ? 415 : 500, { error: preparation.error, preparation });
  } finally {
    uploadInProgress = false;
    releaseReservation();
    preparationController = null;
  }
}

function safeDownloadName(name) {
  return encodeURIComponent(String(name || 'shared-file').replace(/[\r\n]/g, ''));
}

async function serveInstantAsset(req, res, url) {
  const asset = state.asset;
  if (!asset || asset.source !== 'peer' || url.searchParams.get('v') !== asset.version) { json(res, 409, { error: 'The selected file changed.' }); return; }
  let start = 0, end = asset.size - 1, status = 200;
  const range = String(req.headers.range || '');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${asset.size}` }); res.end(); return; }
    start = match[1] ? Number(match[1]) : Math.max(0, asset.size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    status = 206;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= asset.size) { res.writeHead(416, { 'Content-Range': `bytes */${asset.size}` }); res.end(); return; }
  // A browser can request the whole remaining movie. Complete short ranges
  // before sending headers, so a source reconnect cannot truncate that response.
  if (range && req.method !== 'HEAD') end = Math.min(end, start + 2 * 1024 * 1024 - 1);
  const headers = { 'Content-Type': asset.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (range || req.method === 'HEAD') headers['Content-Length'] = end - start + 1;
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${asset.size}`;
  if (req.method === 'HEAD') { res.writeHead(status, headers); res.end(); return; }
  let pendingId = '', closed = false;
  const closedHandler = () => { closed = true; if (pendingId) relayRequests.get(pendingId)?.reject(new Error('Display stopped reading.')); };
  res.once('close', closedHandler);
  try {
    const buffers = [];
    // Relay only a bounded byte range at a time; never store or buffer a movie.
    for (let offset = start; offset <= end && !closed; offset += 512 * 1024) {
      if (state.asset?.version !== asset.version) throw new Error('The selected file changed.');
      if (relayRequests.size >= 32) throw new Error('Too many file requests. Try again.');
      const chunkEnd = Math.min(end, offset + 512 * 1024 - 1);
      pendingId = require('node:crypto').randomUUID();
      const buffer = await new Promise((resolve, reject) => {
        const id = pendingId;
        const finish = (error, bytes) => { const pending = relayRequests.get(id); if (!pending) return; clearTimeout(pending.timer); clearInterval(pending.retryTimer); relayRequests.delete(id); error ? reject(error) : resolve(bytes); };
        const send = () => {
          if (state.asset?.version !== asset.version) { finish(new Error('The selected file changed.')); return; }
          const source = [...viewers].find((viewer) => viewer.peerId === asset.peerId && !viewer.destroyed);
          if (source) try { sendEvent(source, 'source-range', { id, version: asset.version, start: offset, end: chunkEnd }); } catch { /* EventSource reconnects; resend the same request. */ }
        };
        relayRequests.set(id, { version: asset.version, length: chunkEnd - offset + 1, timer: setTimeout(() => finish(new Error('Connection interrupted. Keep the admin source tab open and awake.')), 30000), retryTimer: setInterval(send, 2000), resolve: (bytes) => finish(null, bytes), reject: (error) => finish(error) });
        send();
      });
      pendingId = '';
      if (closed) break;
      if (range) { buffers.push(buffer); continue; }
      // A non-range GET uses chunked transfer, not a movie-sized Content-Length.
      if (!res.headersSent) res.writeHead(status, headers);
      if (!res.write(buffer)) await new Promise((resolve) => {
        const done = () => { res.removeListener('drain', done); res.removeListener('close', done); resolve(); };
        res.once('drain', done); res.once('close', done);
      });
    }
    if (!closed) { if (range) { res.writeHead(status, headers); res.end(Buffer.concat(buffers)); } else res.end(); }
  } catch (error) {
    if (!closed) { if (res.headersSent) res.destroy(); else { res.setHeader('Retry-After', '2'); json(res, 503, { error: error.message }); } }
  } finally { res.removeListener('close', closedHandler); }
}

function serveAsset(req, res) {
  if (!assetFile || !fs.existsSync(assetFile.path)) {
    json(res, 404, { error: 'No file has been selected on the admin Device' });
    return;
  }
  const total = assetFile.size;
  const range = String(req.headers.range || '');
  const headers = {
    'Content-Type': assetFile.type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Disposition': `inline; filename*=UTF-8''${safeDownloadName(assetFile.name)}`,
    'X-Content-Type-Options': 'nosniff',
  };
  if (assetFile.type.startsWith('text/html')) {
    headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'";
  }
  let start = 0;
  let end = total - 1;
  let status = 200;

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }
    if (match[1]) start = Number(match[1]);
    if (match[2]) end = Math.min(Number(match[2]), total - 1);
    if (!match[1] && match[2]) {
      const suffix = Math.min(Number(match[2]), total);
      start = total - suffix;
      end = total - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= total) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(assetFile.path, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

function serveStatic(req, res, pathname) {
  const route = pathname === '/' ? '/index.html' : pathname === '/favicon.ico' ? '/favicon.svg' : pathname;
  const decoded = decodeURIComponent(route);
  const resolved = path.resolve(PUBLIC_DIR, `.${decoded}`);
  if (!resolved.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    json(res, 403, { error: 'Forbidden' });
    return;
  }
  fs.readFile(resolved, (error, data) => {
    if (error) {
      json(res, error.code === 'ENOENT' ? 404 : 500, { error: 'Not found' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentTypes[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'autoplay=(self "https://www.youtube.com" "https://www.youtube-nocookie.com")',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' https://www.youtube.com https://s.ytimg.com; media-src 'self' blob:; img-src 'self' data: blob: https://i.ytimg.com https://yt3.ggpht.com https://api.qrserver.com; connect-src 'self' https://www.youtube.com; frame-src 'self' blob: https://www.youtube.com https://www.youtube-nocookie.com; object-src 'self'",
    });
    res.end(data);
  });
}

async function handle(req, res, url) {
  try {
    if (req.method === 'GET' && url.pathname === '/api/time') {
      json(res, 200, { serverTime: Date.now() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/info') {
      json(res, 200, { port: activePort, hosted: Boolean(room), room, iceServers: iceServers(), addresses: room ? [] : networkDetails().map((item) => item.address), networks: room ? [] : networkDetails(), state: snapshot() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      json(res, 200, { state: snapshot(), screens: activeScreens() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/source/claim') {
      checkOwner(req, true); json(res, 200, { state: snapshot() }); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/source/release') {
      checkOwner(req); releaseReservation(); json(res, 200, { state: snapshot() }); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/source/range') {
      checkOwner(req);
      const pending = relayRequests.get(url.searchParams.get('id'));
      if (!pending || pending.version !== state.asset?.version) { json(res, 409, { error: 'This file request expired.' }); return; }
      const chunks = []; let length = 0;
      try {
        for await (const chunk of req) { length += chunk.length; if (length > pending.length) throw new Error('Invalid file range length.'); chunks.push(chunk); }
        if (length !== pending.length) throw new Error('Incomplete file range.');
        pending.resolve(Buffer.concat(chunks)); json(res, 200, { ok: true });
      } catch (error) { pending.reject(error); throw error; }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/local-source') {
      if (uploadInProgress) throw new Error('Cancel the current preparation first');
      const body = await readJson(req);
      if (!['video', 'audio'].includes(state.sessionMode)) throw new Error('Choose Video or Audio mode first');
      if (body.type && !/^(video|audio)\/[a-z0-9.+-]+$/i.test(body.type)) throw new Error('Choose a video or audio file, not a document');
      const extension = path.extname(String(body.name || '')).toLowerCase();
      const mkvCodecs = Array.isArray(body.codecs) ? body.codecs : [];
      const supportedMkv = mkvCodecs.includes('V_MPEG4/ISO/AVC') && mkvCodecs.every((codec) => codec === 'V_MPEG4/ISO/AVC' || typeof codec === 'string' && /^A_AAC(?:\/MPEG[24]\/(?:MAIN|LC|LC\/SBR|SSR))?$/.test(codec));
      if (state.sessionMode === 'video' && (!validExtensions.video.has(extension) || body.type !== mimeForAsset('video', extension, '') || extension === '.mkv' && !supportedMkv)) {
        json(res, 415, { error: 'This format is not supported. Convert it to MP4 with H.264 video and AAC audio first.' }); return;
      }
      if (!/^[a-f0-9-]{36}$/.test(body.peerId || '') || !/^[a-f0-9]{64}$/.test(body.fingerprint || '') || !Number.isSafeInteger(body.size) || body.size <= 0 || body.size > MAX_ASSET_SIZE) throw new Error('Invalid local file metadata');
      checkOwner(req, true);
      removeCurrentAsset();
      state = { ...state, playing: false, position: 0, anchorTime: Date.now(), commandId: ++commandSequence,
        asset: { name: String(body.name || 'Local movie').slice(0, 220), size: body.size, originalSize: body.size, duration: Number(body.duration) || 0,
          type: String(body.type || 'video/mp4').slice(0, 100), kind: state.sessionMode, renderType: 'media', source: 'peer', transport: body.localOnly === true ? 'hotspot' : body.relay ? 'relay' : 'webrtc', peerId: body.peerId,
          fingerprint: body.fingerprint, codecs: Array.isArray(body.codecs) ? body.codecs.filter((codec) => typeof codec === 'string' && /^(V|A)_[A-Z0-9/_-]{1,60}$/.test(codec)).slice(0, 8) : [], version: require('node:crypto').randomUUID() } };
      for (const screen of screens.values()) Object.assign(screen, { mediaReady: false, duration: 0, playbackTime: 0, error: '' });
      saveSession(); broadcast('state', snapshot()); json(res, 200, { state: snapshot() }); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/peer-signal') {
      const body = await readJson(req);
      if (![body.from, body.to].every((id) => /^[a-f0-9-]{36}$/.test(id || ''))) throw new Error('Invalid peer identity');
      if (![...viewers].some((viewer) => viewer.peerId === body.from)) { json(res, 403, { error: 'Connect your file-sharing tab before signaling' }); return; }
      if (body.description && (!['offer', 'answer'].includes(body.description.type) || typeof body.description.sdp !== 'string' || body.description.sdp.length > 64000)) throw new Error('Invalid peer description');
      const target = [...viewers].find((viewer) => viewer.peerId === body.to);
      if (!target) { json(res, 409, { error: 'The admin source is offline. Keep its dashboard tab open.' }); return; }
      sendEvent(target, 'peer-signal', { from: body.from, description: body.description, candidate: body.candidate }); json(res, 200, { ok: true }); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/media/cancel') {
      checkOwner(req);
      const body = await readJson(req);
      if (!preparationController || !preparation || !uploadInProgress) { json(res, 200, { state: snapshot() }); return; }
      if (body.version !== preparation.version) throw new Error('The preparation changed. Cancel the current file instead');
      preparationController.abort();
      json(res, 200, { state: snapshot() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/youtube/tools') {
      json(res, 200, await downloads.capabilities());
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/youtube/formats') {
      const body = await readJson(req);
      json(res, 200, await downloads.inspect(extractYouTubeId(body.url)));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/youtube/downloads') {
      const body = await readJson(req);
      json(res, 202, downloads.start(String(body.inspectionId), String(body.optionId), room));
      return;
    }
    const downloadRoute = /^\/api\/youtube\/downloads\/([a-f0-9-]{36})(?:\/(file|cancel|load))?$/.exec(url.pathname);
    if (downloadRoute) {
      const job = downloads.get(downloadRoute[1]);
      if ((job.room || '') !== room) throw new Error('Download not found in this session');
      const action = downloadRoute[2];
      if (req.method === 'GET' && !action) { json(res, 200, downloads.publicJob(job)); return; }
      if (req.method === 'POST' && action === 'cancel') { json(res, 200, downloads.cancel(job.id)); return; }
      if (['GET', 'HEAD'].includes(req.method) && action === 'file') {
        if (job.state !== 'ready' || !job.path) { json(res, 409, { error: 'This download is not ready yet.' }); return; }
        res.writeHead(200, { 'Content-Type': job.option.kind === 'video' ? `video/${job.option.container}` : job.option.container === 'mp3' ? 'audio/mpeg' : job.option.container === 'm4a' ? 'audio/mp4' : job.option.container === 'aac' ? 'audio/aac' : 'audio/wav',
          'Content-Length': fs.statSync(job.path).size, 'Content-Disposition': `attachment; filename*=UTF-8''${safeDownloadName(job.fileName)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        if (req.method === 'HEAD') res.end();
        else { const stream = fs.createReadStream(job.path); stream.on('error', () => res.destroy()); stream.pipe(res); res.on('close', () => stream.destroy()); }
        return;
      }
      if (req.method === 'POST' && action === 'load') {
        const targetMode = state.sessionMode;
        const validDownload = targetMode === 'audio' ? job.option.kind === 'audio' && ['mp3', 'm4a', 'aac', 'wav'].includes(job.option.container) : targetMode === 'video' && job.option.kind === 'video' && job.option.container === 'mp4';
        if (!validDownload || uploadInProgress) { json(res, 409, { error: 'Open the matching video/audio dashboard and finish any current upload first.' }); return; }
        checkOwner(req, true);
        uploadInProgress = true;
        const version = `download-${Date.now()}-${job.id}`;
        const destination = path.join(CACHE_DIR, `asset-${version}.${job.option.container}`);
        try {
          const file = targetMode === 'audio' ? await downloads.copyForSpeakers(job.id, destination) : await downloads.copyForWall(job.id, destination);
          if (state.sessionMode !== targetMode) throw new Error('The mode changed during preparation. Return to the matching dashboard and try again.');
          const previousPath = assetFile?.path;
          assetFile = { path: destination, ...file, originalSize: file.size, type: file.type || 'video/mp4', version, kind: targetMode, renderType: 'media', pageCount: 0, converted: false };
          const { path: privatePath, ...asset } = assetFile;
          state = { ...state, playing: false, position: 0, anchorTime: Date.now(), notBefore: 0, asset, commandId: ++commandSequence };
          for (const screen of screens.values()) { screen.mediaReady = false; screen.duration = 0; screen.error = ''; }
          if (previousPath && previousPath !== destination) fs.unlink(previousPath, () => {});
          saveSession();
          broadcast('state', snapshot());
          json(res, 200, { state: snapshot() });
        } catch (error) {
          await fs.promises.unlink(destination).catch(() => {});
          throw error;
        } finally { uploadInProgress = false; releaseReservation(); }
        return;
      }
      json(res, 405, { error: 'Method not allowed' });
      return;
    }
    if (req.method === 'POST' && (url.pathname === '/api/media' || url.pathname === '/api/movie')) {
      if (url.pathname === '/api/movie' && !url.searchParams.has('kind')) url.searchParams.set('kind', 'video');
      await receiveAsset(req, res, url);
      return;
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/api/media/stream' || url.pathname === '/api/movie/stream')) {
      if (state.asset?.transport === 'hotspot') { json(res, 409, { error: 'Instant shares over your hotspot, not this server. Open the numbered screen link, or choose Upload.' }); return; }
      if (state.asset?.source === 'peer') await serveInstantAsset(req, res, url);
      else if (url.searchParams.get('v') && url.searchParams.get('v') !== state.asset?.version) json(res, 409, { error: 'The selected file changed.' });
      else serveAsset(req, res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(': connected\n\n');
      viewers.add(res);
      res.peerId = /^[a-f0-9-]{36}$/.test(url.searchParams.get('peer') || '') ? url.searchParams.get('peer') : '';
      if (res.peerId) for (const previous of viewers) if (previous !== res && previous.peerId === res.peerId) { viewers.delete(previous); previous.end(); }
      sendEvent(res, 'state', snapshot());
      req.on('close', () => viewers.delete(res));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/status') {
      const body = await readJson(req);
      const screen = Number(body.screen);
      const id = String(body.clientId || '').slice(0, 80);
      if (!id || !Number.isInteger(screen) || screen < 1 || screen > 5) throw new Error('Invalid screen status');
      screens.set(id, {
        clientId: id,
        deviceId: /^[a-f0-9-]{36}$/i.test(String(req.headers['x-cinewall-device'] || '')) ? String(req.headers['x-cinewall-device']) : '',
        screen,
        build: String(body.build || '').slice(0, 80),
        ready: Boolean(body.ready),
        mediaReady: Boolean(body.mediaReady),
        assetVersion: String(body.assetVersion || '').slice(0, 100),
        instantConnection: ['idle', 'local', 'searching', 'connected', 'disconnected'].includes(body.instantConnection) ? body.instantConnection : 'idle',
        loadProgress: Math.min(100, Math.max(0, Number(body.loadProgress) || 0)),
        bufferedSeconds: Math.max(0, Number(body.bufferedSeconds) || 0),
        fileName: String(body.fileName || '').slice(0, 220),
        fileSize: Number(body.fileSize) || 0,
        duration: Number(body.duration) || 0,
        playbackTime: Number(body.playbackTime) || 0,
        page: Number(body.page) || 0,
        paused: Boolean(body.paused),
        ended: Boolean(body.ended) && body.assetVersion === state.asset?.version,
        playerState: Number(body.playerState),
        buffering: Boolean(body.buffering),
        autoplayMuted: Boolean(body.autoplayMuted),
        error: String(body.error || '').slice(0, 300),
        lastSeen: Date.now(),
      });
      json(res, 200, { ok: true, state: snapshot() });
      broadcast('screens', { screens: activeScreens(), serverTime: Date.now() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/command') {
      const input = await readJson(req);
      if (sourceOwner && !['identify', 'screen-audio'].includes(input.type)) checkOwner(req);
      if (input.type === 'load-youtube') { extractYouTubeId(input.url); checkOwner(req, true); }
      const command = applyCommand(input);
      json(res, 200, { ok: true, command });
      return;
    }
    if (req.method === 'GET') {
      serveStatic(req, res, url.pathname);
      return;
    }
    json(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    json(res, error.status || 400, { error: error.message || 'Bad request' });
  }
}

return { handle, pulse() { broadcast('pulse', snapshot()); activeScreens(); }, lastUsed: Date.now(), idle() { return !viewers.size && !uploadInProgress; }, close() { for (const viewer of viewers) viewer.end(); } };
}

function iceServers() {
  try { const servers = JSON.parse(process.env.CINEWALL_ICE_SERVERS || '[]'); if (Array.isArray(servers) && servers.length) return servers; } catch {}
  return [{ urls: 'stun:stun.l.google.com:19302' }];
}
function isLocalHost(host) {
  const hostname = host.toLowerCase().replace(/:\d+$/, '');
  return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostname) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
}
const sessions = new Map();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const room = url.searchParams.get('room') || '';
  const hosted = process.env.CINEWALL_HOSTED === '1' || Boolean(process.env.RAILWAY_ENVIRONMENT) || !isLocalHost(String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim());
  if ((room && !/^[a-f0-9-]{36}$/.test(room)) || (hosted && !room && (url.pathname.startsWith('/api/') || url.pathname === '/events'))) {
    res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Open your private CineWall session link first.' })); return;
  }
  const key = room || '';
  if (!sessions.has(key)) {
    if (sessions.size >= 64) { res.writeHead(503); res.end('Too many active sessions. Try later.'); return; }
    sessions.set(key, createSession(key));
  }
  const session = sessions.get(key);
  session.lastUsed = Date.now();
  await session.handle(req, res, url);
});

const pulse = setInterval(() => {
  for (const [key, session] of sessions) {
    session.pulse();
    if (key && session.idle() && Date.now() - session.lastUsed > 30 * 60 * 1000) { session.close(); sessions.delete(key); }
  }
}, 2000);
pulse.unref();

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE' && activePort < PREFERRED_PORT + MAX_PORT_ATTEMPTS - 1) {
    const busyPort = activePort;
    activePort += 1;
    console.log(`Port ${busyPort} is already in use. Trying ${activePort} instead…`);
    setTimeout(() => server.listen(activePort, HOST), 100);
    return;
  }
  console.error(`\nThe CineWall server could not start: ${error.message}\n`);
  process.exitCode = 1;
});

server.on('listening', () => {
  const networks = Object.values(os.networkInterfaces()).flat().filter((item) => item.family === 'IPv4' && !item.internal);
  console.log('\nCineWall Studio is running.\n');
  console.log(`Start:  http://localhost:${activePort}/`);
  console.log(`Admin:  http://localhost:${activePort}/admin.html`);
  if (networks.length) {
    console.log('\nRecommended display link:');
    console.log(`  http://${networks[0].address}:${activePort}/screen.html`);
    for (const network of networks.slice(1)) {
      const label = network.address === '192.168.137.1' ? 'Mobile Hotspot link' : 'Alternative link';
      console.log(`${label}:`);
      console.log(`  http://${network.address}:${activePort}/screen.html`);
    }
  }
  console.log('\nKeep this window open. Press Ctrl+C to stop.\n');
});

server.listen(activePort, HOST);
