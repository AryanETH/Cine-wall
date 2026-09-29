'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PREFERRED_PORT = Number(process.env.PORT || 4173);
const MAX_PORT_ATTEMPTS = 20;
let activePort = PREFERRED_PORT;
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const CACHE_DIR = path.join(__dirname, '.cinema-cache');
const MAX_BODY = 64 * 1024;
const MAX_MOVIE_SIZE = 50 * 1024 * 1024 * 1024;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const viewers = new Set();
const screens = new Map();
let commandSequence = 0;
let movieFile = null;
let uploadInProgress = false;
let state = {
  playing: false,
  position: 0,
  anchorTime: Date.now(),
  mode: 'stretch',
  screenCount: 3,
  audioScreen: 2,
  movie: null,
  commandId: 0,
};

fs.mkdirSync(CACHE_DIR, { recursive: true });

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
      if (size > MAX_BODY) {
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
  return { ...state, serverTime: Date.now() };
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

function applyCommand(input) {
  const now = Date.now();
  const executeAt = now + 850;
  const type = String(input.type || '');
  let position = currentPosition(executeAt);

  if (type === 'play') {
    if (!state.movie) throw new Error('Choose a movie on the admin laptop first');
    if (Number.isFinite(input.position)) position = Math.max(0, Number(input.position));
    state = { ...state, playing: true, position, anchorTime: executeAt };
  } else if (type === 'pause') {
    state = { ...state, playing: false, position, anchorTime: executeAt };
  } else if (type === 'seek') {
    position = Math.max(0, Number(input.position) || 0);
    state = { ...state, position, anchorTime: executeAt };
  } else if (type === 'restart') {
    state = { ...state, position: 0, anchorTime: executeAt };
  } else if (type === 'mode') {
    if (!['fit', 'crop', 'stretch'].includes(input.mode)) throw new Error('Unknown wall mode');
    state = { ...state, mode: input.mode };
  } else if (type === 'layout') {
    const screenCount = Number(input.screenCount);
    if (![2, 3].includes(screenCount)) throw new Error('The wall must use two or three screens');
    state = { ...state, screenCount, audioScreen: state.audioScreen === 'all' ? 'all' : Math.min(state.audioScreen, screenCount) };
  } else if (type === 'audio') {
    const audioScreen = input.screen === 'all' ? 'all' : Number(input.screen);
    if (audioScreen !== 'all' && (![0, 1, 2, 3].includes(audioScreen) || audioScreen > state.screenCount)) throw new Error('Unknown audio screen');
    state = { ...state, audioScreen };
  } else if (type === 'identify') {
    // Identify is visual-only and does not change playback state.
  } else {
    throw new Error('Unknown command');
  }

  state.commandId = ++commandSequence;
  const command = { type, executeAt, ...state, serverTime: now };
  if (type === 'identify') command.identify = true;
  broadcast('command', command);
  broadcast('state', snapshot());
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

function networkAddresses() {
  return networkDetails().map((item) => item.address);
}

function activeScreens() {
  const cutoff = Date.now() - 7000;
  for (const [id, info] of screens) {
    if (info.lastSeen < cutoff) screens.delete(id);
  }
  return [...screens.values()].sort((a, b) => a.screen - b.screen || a.lastSeen - b.lastSeen);
}

function receiveMovie(req, res, url) {
  return new Promise((resolve) => {
    if (uploadInProgress) {
      json(res, 409, { error: 'Another movie is still being prepared' });
      resolve();
      return;
    }

    const size = Number(req.headers['content-length'] || 0);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_MOVIE_SIZE) {
      json(res, 400, { error: 'Movie size is missing, empty, or larger than 50 GB' });
      resolve();
      return;
    }

    let name = 'movie.mp4';
    try {
      name = decodeURIComponent(url.searchParams.get('name') || name).slice(0, 220);
    } catch {
      name = 'movie.mp4';
    }
    const typeHeader = String(req.headers['content-type'] || 'application/octet-stream');
    const type = typeHeader.startsWith('video/') ? typeHeader : 'application/octet-stream';
    const version = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const extension = path.extname(name).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12) || '.video';
    const temporaryPath = path.join(CACHE_DIR, `upload-${version}.tmp`);
    const finalPath = path.join(CACHE_DIR, `movie-${version}${extension}`);
    const output = fs.createWriteStream(temporaryPath, { flags: 'wx' });
    let received = 0;
    let settled = false;
    uploadInProgress = true;

    const fail = (message) => {
      if (settled) return;
      settled = true;
      uploadInProgress = false;
      output.destroy();
      fs.unlink(temporaryPath, () => {});
      if (!res.headersSent) json(res, 500, { error: message });
      resolve();
    };

    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > MAX_MOVIE_SIZE) fail('Movie is larger than 50 GB');
    });
    req.on('aborted', () => fail('Movie transfer was interrupted'));
    req.on('error', () => fail('Movie transfer failed'));
    output.on('error', () => fail('The movie could not be saved on the admin laptop'));
    output.on('finish', () => {
      if (settled) return;
      output.close(() => {
        if (received !== size) {
          fail('Movie transfer was incomplete');
          return;
        }
        fs.rename(temporaryPath, finalPath, (error) => {
          if (error) {
            fail('The movie could not be prepared');
            return;
          }
          settled = true;
          uploadInProgress = false;
          const previousPath = movieFile?.path;
          movieFile = { path: finalPath, name, size, type, version };
          state = {
            ...state,
            playing: false,
            position: 0,
            anchorTime: Date.now(),
            movie: { name, size, type, version },
            commandId: ++commandSequence,
          };
          for (const screen of screens.values()) {
            screen.mediaReady = false;
            screen.duration = 0;
          }
          if (previousPath && previousPath !== finalPath) fs.unlink(previousPath, () => {});
          broadcast('state', snapshot());
          json(res, 200, { ok: true, movie: state.movie, state: snapshot() });
          resolve();
        });
      });
    });
    req.pipe(output);
  });
}

function serveMovie(req, res) {
  if (!movieFile || !fs.existsSync(movieFile.path)) {
    json(res, 404, { error: 'No movie has been selected on the admin laptop' });
    return;
  }
  const total = movieFile.size;
  const range = String(req.headers.range || '');
  const baseHeaders = {
    'Content-Type': movieFile.type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
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
    baseHeaders['Content-Range'] = `bytes ${start}-${end}/${total}`;
  }
  baseHeaders['Content-Length'] = end - start + 1;
  res.writeHead(status, baseHeaders);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(movieFile.path, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

function serveStatic(req, res, pathname) {
  const route = pathname === '/' ? '/index.html' : pathname;
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
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; media-src 'self' blob:; img-src 'self' data:; connect-src 'self'",
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/time') {
      json(res, 200, { serverTime: Date.now() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/info') {
      json(res, 200, { port: activePort, addresses: networkAddresses(), networks: networkDetails(), state: snapshot() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      json(res, 200, { state: snapshot(), screens: activeScreens() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/movie') {
      await receiveMovie(req, res, url);
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/api/movie/stream') {
      serveMovie(req, res);
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
      sendEvent(res, 'state', snapshot());
      req.on('close', () => viewers.delete(res));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/status') {
      const body = await readJson(req);
      const screen = Number(body.screen);
      const id = String(body.clientId || '').slice(0, 80);
      if (!id || ![1, 2, 3].includes(screen)) throw new Error('Invalid screen status');
      screens.set(id, {
        clientId: id,
        screen,
        ready: Boolean(body.ready),
        mediaReady: Boolean(body.mediaReady),
        fileName: String(body.fileName || '').slice(0, 220),
        fileSize: Number(body.fileSize) || 0,
        duration: Number(body.duration) || 0,
        playbackTime: Number(body.playbackTime) || 0,
        paused: Boolean(body.paused),
        error: String(body.error || '').slice(0, 300),
        lastSeen: Date.now(),
      });
      json(res, 200, { ok: true, state: snapshot() });
      broadcast('screens', { screens: activeScreens(), serverTime: Date.now() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/command') {
      const command = applyCommand(await readJson(req));
      json(res, 200, { ok: true, command });
      return;
    }

    if (req.method === 'GET') {
      serveStatic(req, res, url.pathname);
      return;
    }

    json(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    json(res, 400, { error: error.message || 'Bad request' });
  }
});

const pulse = setInterval(() => {
  broadcast('pulse', snapshot());
  activeScreens();
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
  console.error(`\nThe cinema server could not start: ${error.message}\n`);
  process.exitCode = 1;
});

server.on('listening', () => {
  const networks = networkDetails();
  console.log('\nCineWall is running.\n');
  console.log(`Admin:  http://localhost:${activePort}/admin.html`);
  if (networks.length) {
    console.log('\nRecommended screen link (devices on the same Wi-Fi):');
    console.log(`  http://${networks[0].address}:${activePort}/screen.html`);
    for (const network of networks.slice(1)) {
      const label = network.isHotspot ? 'Mobile Hotspot link' : `Alternative link (${network.name})`;
      console.log(`${label}:`);
      console.log(`  http://${network.address}:${activePort}/screen.html`);
    }
  } else {
    console.log(`\nScreen: http://<ADMIN-LAPTOP-IP>:${activePort}/screen.html`);
  }
  console.log('\nKeep this window open. Press Ctrl+C to stop.\n');
});

server.listen(activePort, HOST);

