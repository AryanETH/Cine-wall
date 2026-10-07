'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const screen = Number(new URL(location.href).searchParams.get('screen') || 0);
  const viewer = Number.isInteger(screen) && screen > 0 && screen <= 3;
  const id = crypto.randomUUID?.() || '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, character => (character ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> character / 4).toString(16));
  const video = $('#shareVideo'), stage = $('#shareStage'), canvas = $('#shareCanvas');
  const connections = new Map(), dots = new Map();
  let stream = null, events = null, current = null, registration = null;
  let stateVersion = '', status = 'waiting', starting = false, pointerOn = false, leaving = false;
  let remoteOrigin = location.origin;
  let pointerSentAt = 0, linksKey = '', qualityKey = '', barTimer;
  const labels = { waiting: 'Waiting', connecting: 'Connecting…', connected: 'Connected', disconnected: 'Connection lost', tap: 'Tap to view' };

  async function api(action, body = {}) {
    const response = await fetch(`/api/share/${action}`, { method: 'POST', keepalive: action === 'leave', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, peerId: id }) });
    const result = await response.json();
    if (!response.ok) { const error = new Error(result.error || 'Could not connect.'); error.status = response.status; throw error; }
    return result;
  }
  function error(message = '') { $('#shareError').hidden = !message; $('#shareError').textContent = message; }
  function closeConnections() { for (const connection of connections.values()) connection.pc.close(); connections.clear(); clearPointers(); }
  function releaseCapture() { const previous = stream; stream = null; previous?.getTracks().forEach(track => track.stop()); video.srcObject = null; qualityKey = ''; }
  function clearPointers() { for (const dot of dots.values()) { clearTimeout(dot.timer); dot.element.remove(); } dots.clear(); }
  function setStatus(next) { status = next; $('#shareStatus').textContent = labels[next]; $('#shareStatus').classList.toggle('online', next === 'connected'); }
  function empty(title, copy) { $('#shareEmpty').hidden = false; $('#shareEmptyTitle').textContent = title; $('#shareEmptyCopy').textContent = copy; }

  function renderLinks() {
    if (viewer || !current) return;
    const key = `${current.settings.count}:${current.source?.peerId}:${current.revision}:${remoteOrigin}`;
    if (key === linksKey) return;
    linksKey = key;
    const existingFocus = document.activeElement?.dataset.copyScreen;
    $('#shareLinks').replaceChildren();
    for (let number = 1; number <= current.settings.count; number++) {
      const card = document.createElement('article'); card.className = 'share-link';
      const badge = document.createElement('span'); badge.className = 'display-number'; badge.textContent = number;
      const name = document.createElement('div'), title = document.createElement('strong'), note = document.createElement('small');
      title.textContent = `Screen ${number}`;
      const peers = current.peers.filter(peer => peer.screen === number);
      note.textContent = peers.some(peer => peer.status === 'connected') ? 'Connected' : peers.length ? labels[peers[0].status] || 'Waiting' : number === 1 ? 'This laptop' : 'Open on another laptop';
      name.append(title, note); card.append(badge, name);
      if (number === current.settings.count && number > 1) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'share-remove'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove Screen ${number}`); remove.dataset.removeScreen = number; remove.disabled = locked(); card.append(remove);
      }
      const actions = document.createElement('div'); actions.className = 'share-link-actions';
      const open = document.createElement('a'); open.href = window.CineWallSession.link(`/share.html?screen=${number}`, number === 1 ? location.origin : remoteOrigin); open.target = '_blank'; open.rel = 'noopener'; open.textContent = 'Open'; open.setAttribute('aria-label', `Open Screen ${number}`);
      const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy link'; copy.dataset.copyScreen = number; copy.dataset.link = open.href;
      actions.append(open, copy); card.append(actions); $('#shareLinks').append(card);
    }
    if (existingFocus) $('#shareLinks').querySelector(`[data-copy-screen="${existingFocus}"]`)?.focus();
    $('#addShareScreen').disabled = locked() || current.settings.count >= 3;
    $('#addShareScreen').hidden = current.settings.count >= 3;
  }
  function locked() { return Boolean(current?.source && current.source.peerId !== id); }
  function layout() {
    if (!current) return;
    canvas.style.transform = current.settings.flip ? 'scaleX(-1)' : '';
    if (viewer && current.settings.layout === 'wall' && video.videoWidth && video.videoHeight) {
      const count = current.settings.count, totalWidth = stage.clientWidth * count;
      const scale = Math.min(totalWidth / video.videoWidth, stage.clientHeight / video.videoHeight);
      canvas.style.width = `${video.videoWidth * scale}px`;
      canvas.style.height = `${video.videoHeight * scale}px`;
      canvas.style.left = `${(totalWidth - video.videoWidth * scale) / 2 - stage.clientWidth * (screen - 1)}px`;
      canvas.style.top = `${(stage.clientHeight - video.videoHeight * scale) / 2}px`;
    } else { canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.left = '0'; canvas.style.top = '0'; }
    positionDots();
  }
  function contentBounds() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!video.videoWidth || !video.videoHeight) return { width, height, left: 0, top: 0 };
    const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
    return { width: video.videoWidth * scale, height: video.videoHeight * scale, left: (width - video.videoWidth * scale) / 2, top: (height - video.videoHeight * scale) / 2 };
  }
  function positionDots() {
    const bounds = contentBounds();
    for (const dot of dots.values()) { dot.element.style.left = `${bounds.left + dot.x * bounds.width}px`; dot.element.style.top = `${bounds.top + dot.y * bounds.height}px`; }
  }
  function receivePointer(data, from) {
    if (!current?.settings.pointers || !data || data.type !== 'pointer' || !Number.isFinite(data.x) || !Number.isFinite(data.y) || data.x < 0 || data.x > 1 || data.y < 0 || data.y > 1) return;
    let dot = dots.get(from);
    if (!dot) {
      const element = document.createElement('div'); element.className = 'share-dot';
      const text = document.createElement('span'); text.textContent = from === current.source?.peerId ? 'Presenter' : `Screen ${current.peers.find(peer => peer.peerId === from)?.screen || ''}`;
      element.append(text); $('#sharePointerLayer').append(element); dot = { element }; dots.set(from, dot);
    }
    Object.assign(dot, { x: data.x, y: data.y }); positionDots(); clearTimeout(dot.timer);
    dot.timer = setTimeout(() => { dot.element.remove(); dots.delete(from); }, 1500);
  }
  function sendPointer(data, except) {
    for (const [peerId, connection] of connections) if (peerId !== except && connection.channel?.readyState === 'open') {
      try { connection.channel.send(JSON.stringify(data)); } catch {}
    }
  }
  function bindChannel(connection, channel, from) {
    connection.channel = channel;
    channel.onmessage = event => {
      if (typeof event.data !== 'string' || event.data.length > 256) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type !== 'pointer' || !current?.settings.pointers) return;
        const author = viewer && typeof data.author === 'string' ? data.author : from;
        receivePointer(data, author);
        if (!viewer) sendPointer({ type: 'pointer', x: data.x, y: data.y, author: from }, from);
      } catch {}
    };
  }

  async function adjustQuality() {
    if (!stream || !current) return;
    const quality = current.settings.quality;
    if (qualityKey !== quality) {
      qualityKey = quality;
      const height = quality === '720p' ? 720 : 1080;
      try { await stream.getVideoTracks()[0]?.applyConstraints({ width: { ideal: height * 16 / 9 }, height: { ideal: height }, frameRate: { ideal: 30, max: 30 } }); } catch { /* Browsers choose the closest available capture size. */ }
    }
    for (const connection of connections.values()) for (const sender of connection.pc.getSenders()) if (sender.track?.kind === 'video') {
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) continue;
      const bitrate = quality === '720p' ? 2000000 : quality === '1080p' ? 5000000 : 3500000;
      if (parameters.encodings[0].maxBitrate === bitrate) continue;
      parameters.encodings[0].maxBitrate = bitrate;
      try { await sender.setParameters(parameters); } catch {}
    }
  }

  function makeConnection(peerId) {
    const pc = new RTCPeerConnection({ iceServers: [] });
    const connection = { pc, version: current.source.version, candidates: [], queue: Promise.resolve() };
    connections.set(peerId, connection);
    const signal = body => api('signal', { ...body, to: peerId, version: connection.version });
    pc.onicecandidate = event => { if (event.candidate && pc.connectionState !== 'closed') void signal({ candidate: event.candidate.toJSON() }).catch(() => {}); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') { if (viewer) { setStatus('connected'); error(); } void adjustQuality(); }
      if (['failed', 'disconnected'].includes(pc.connectionState)) {
        pc.close(); if (connections.get(peerId) === connection) connections.delete(peerId);
        if (viewer) { setStatus('disconnected'); empty('Reconnecting…', 'Keep the sharing laptop awake and use the same Wi-Fi.'); }
      }
    };
    pc.ontrack = event => {
      if (!viewer || connection.version !== current?.source?.version) return;
      video.srcObject = event.streams[0] || new MediaStream([event.track]);
      void playView();
    };
    pc.ondatachannel = event => bindChannel(connection, event.channel, peerId);
    if (!viewer && stream) {
      for (const track of stream.getTracks()) pc.addTrack(track, stream);
      bindChannel(connection, pc.createDataChannel('shared-pointer', { ordered: false, maxRetransmits: 0 }), peerId);
    }
    return connection;
  }
  async function offer(peerId) {
    if (connections.has(peerId) || !stream || !current?.source || current.source.peerId !== id) return;
    const connection = makeConnection(peerId);
    try {
      await connection.pc.setLocalDescription(await connection.pc.createOffer());
      await api('signal', { to: peerId, version: connection.version, description: connection.pc.localDescription.toJSON() });
    } catch {
      connection.pc.close(); if (connections.get(peerId) === connection) connections.delete(peerId);
    }
  }
  async function onSignal(data) {
    if (!current?.source || current.source.version !== data.version) return;
    if (viewer && (data.from !== current.source.peerId || screen > current.settings.count)) return;
    if (!viewer && (!stream || current.source.peerId !== id || !current.peers.some(peer => peer.peerId === data.from && peer.screen <= current.settings.count))) return;
    const connection = connections.get(data.from) || makeConnection(data.from);
    connection.queue = connection.queue.then(async () => {
      if (connection.pc.connectionState === 'closed') return;
      if (data.description) {
        await connection.pc.setRemoteDescription(data.description);
        for (const candidate of connection.candidates.splice(0)) await connection.pc.addIceCandidate(candidate);
        if (data.description.type === 'offer') {
          await connection.pc.setLocalDescription(await connection.pc.createAnswer());
          await api('signal', { to: data.from, version: connection.version, description: connection.pc.localDescription.toJSON() });
        }
      } else if (data.candidate) {
        if (connection.pc.remoteDescription) await connection.pc.addIceCandidate(data.candidate);
        else if (connection.candidates.length < 128) connection.candidates.push(data.candidate);
      }
    }).catch(() => { if (viewer) setStatus('disconnected'); });
    return connection.queue;
  }
  async function playView() {
    try { await video.play(); $('#shareEnable').hidden = true; $('#shareEmpty').hidden = true; if (viewer) setStatus('connected'); }
    catch { $('#shareEnable').hidden = false; if (viewer) setStatus('tap'); }
    layout();
  }
  function applyState(next) {
    if (current && next.revision < current.revision) return;
    const changed = stateVersion !== (next.source?.version || '');
    current = next;
    if (changed) { stateVersion = next.source?.version || ''; closeConnections(); if (viewer) video.srcObject = null; }
    if (!viewer && stream && (!next.source || next.source.peerId !== id) && !starting) releaseCapture();
    const source = next.source;
    $('#shareSourceName').textContent = source?.name || 'No screen shared';
    if (viewer) {
      $('#shareSound').disabled = !source?.audio || screen > next.settings.count;
      $('#shareSound').textContent = source?.audio ? video.muted ? 'Enable sound' : 'Mute sound' : 'No sound shared';
    }
    $('#startShare').hidden = Boolean(stream && source?.peerId === id);
    $('#startShare').disabled = locked() || starting || !navigator.mediaDevices?.getDisplayMedia;
    $('#stopShare').hidden = !(stream && source?.peerId === id);
    $('#hostControls').querySelectorAll('select, input, [data-layout]').forEach(control => { control.disabled = locked(); });
    $('#shareLayout').querySelectorAll('[data-layout]').forEach(button => { const active = button.dataset.layout === next.settings.layout; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    $('#shareQuality').value = next.settings.quality; $('#shareFlip').checked = next.settings.flip; $('#sharePointers').checked = next.settings.pointers;
    $('#sharePointer').disabled = !source || !next.settings.pointers;
    if (!next.settings.pointers) { pointerOn = false; clearPointers(); $('#sharePointer').setAttribute('aria-pressed', 'false'); }
    if (viewer && screen > next.settings.count) { closeConnections(); video.srcObject = null; setStatus('waiting'); empty('Screen removed', 'Ask the sharing laptop to add this screen again.'); $('#shareEnable').hidden = true; }
    else if (!source) { setStatus('waiting'); empty(viewer ? 'Waiting for the sharing laptop' : 'Your shared view appears here', viewer ? 'Ask the presenter to press Share screen.' : 'Press Share screen to begin.'); $('#shareEnable').hidden = true; }
    else if (!viewer && source.peerId === id && stream) {
      if (video.srcObject !== stream) { video.srcObject = stream; video.muted = true; void playView(); }
      setStatus('connected');
      for (const [peerId, connection] of connections) if (!next.peers.some(peer => peer.peerId === peerId && peer.screen <= next.settings.count)) { connection.pc.close(); connections.delete(peerId); }
      for (const peer of next.peers) if (peer.screen <= next.settings.count) void offer(peer.peerId);
      void adjustQuality();
    } else if (!viewer && locked()) { setStatus('connected'); empty('Another laptop is sharing', 'Open a numbered screen below to watch.'); }
    else if (viewer && !video.srcObject) { setStatus('connecting'); empty('Connecting to the shared view', 'Use the same Wi-Fi and keep the sharing tab open.'); }
    renderLinks(); layout();
  }

  async function register() {
    if (registration) return registration;
    registration = (async () => {
      const [result, info] = await Promise.all([
        api('join', { screen: viewer ? screen : 0 }),
        fetch('/api/info', { cache: 'no-store' }).then(response => response.json()).catch(() => null),
      ]);
      if (!viewer && !window.CineWallSession.hosted && !info?.hosted && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
        const address = info?.networks?.find(network => network.isHotspot)?.address || info?.addresses?.[0];
        if (address) remoteOrigin = `http://${address}:${info.port}`;
      }
      events?.close();
      events = new EventSource(`/share-events?peer=${id}&token=${encodeURIComponent(result.token)}`);
      events.addEventListener('share-state', event => applyState(JSON.parse(event.data)));
      events.addEventListener('share-signal', event => { void onSignal(JSON.parse(event.data)); });
      events.onerror = () => { if (viewer) setStatus('disconnected'); };
      applyState(result.state);
    })().finally(() => { registration = null; });
    return registration;
  }
  async function stop() {
    releaseCapture();
    try { if (current?.source?.peerId === id) applyState(await api('stop')); }
    catch (problem) { error(problem.message); }
  }
  async function changeSettings(body) { try { applyState(await api('settings', body)); } catch (problem) { error(problem.message); } }
  $('#startShare').addEventListener('click', async () => {
    if (starting || locked()) return;
    if (!navigator.mediaDevices?.getDisplayMedia) { error('Start sharing in desktop Chrome or Edge. Use the HTTPS website, or localhost on the laptop running CineWall.'); return; }
    starting = true; error(); $('#startShare').disabled = true;
    let capture;
    try {
      // Invoke directly during the click: capture permission cannot be reused or
      // granted by a server command, and the browser always chooses the source.
      capture = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: true, selfBrowserSurface: 'exclude', surfaceSwitching: 'include' });
      releaseCapture(); stream = capture;
      const track = stream.getVideoTracks()[0]; track.contentHint = 'detail';
      track.addEventListener('ended', () => { if (stream === capture) void stop(); });
      const result = await api('start', { name: track.label || 'Shared screen', audio: stream.getAudioTracks().length > 0 });
      starting = false; applyState(result);
    } catch (problem) {
      capture?.getTracks().forEach(track => track.stop()); releaseCapture();
      if (problem.name !== 'NotAllowedError' && problem.name !== 'AbortError') error(problem.message || 'Could not share this screen.');
    } finally { starting = false; if (current) applyState(current); }
  });
  $('#stopShare').addEventListener('click', () => { void stop(); });
  $('#shareLayout').addEventListener('click', event => { const button = event.target.closest('[data-layout]'); if (button) void changeSettings({ layout: button.dataset.layout }); });
  $('#shareQuality').addEventListener('change', event => { void changeSettings({ quality: event.target.value }); });
  $('#shareFlip').addEventListener('change', event => { void changeSettings({ flip: event.target.checked }); });
  $('#sharePointers').addEventListener('change', event => { void changeSettings({ pointers: event.target.checked }); });
  $('#addShareScreen').addEventListener('click', () => { if (current) void changeSettings({ count: current.settings.count + 1 }); });
  $('#shareLinks').addEventListener('click', async event => {
    const remove = event.target.closest('[data-remove-screen]');
    if (remove) { void changeSettings({ count: Number(remove.dataset.removeScreen) - 1 }); return; }
    const copy = event.target.closest('[data-copy-screen]');
    if (copy) { try { await navigator.clipboard.writeText(copy.dataset.link); copy.textContent = 'Copied'; } catch { error(`Copy this link: ${copy.dataset.link}`); } }
  });
  $('#shareEnable').addEventListener('click', () => { void playView(); });
  $('#shareSound').hidden = !viewer;
  $('#shareSound').addEventListener('click', () => { video.muted = !video.muted; $('#shareSound').textContent = video.muted ? 'Enable sound' : 'Mute sound'; $('#shareSound').setAttribute('aria-pressed', String(video.muted)); void playView(); });
  $('#shareFullscreen').addEventListener('click', () => { const target = viewer ? document.documentElement : stage; if (document.fullscreenElement) void document.exitFullscreen(); else void target.requestFullscreen?.().catch(() => error('Use your browser’s fullscreen button.')); });
  $('#sharePointer').addEventListener('click', () => { pointerOn = !pointerOn; $('#sharePointer').setAttribute('aria-pressed', String(pointerOn)); stage.style.cursor = pointerOn ? 'crosshair' : ''; });
  stage.addEventListener('pointermove', event => {
    if (!pointerOn || !current?.settings.pointers || performance.now() - pointerSentAt < 45) return;
    pointerSentAt = performance.now();
    const box = canvas.getBoundingClientRect(), bounds = contentBounds();
    let x = (event.clientX - box.left - bounds.left) / bounds.width;
    if (current.settings.flip) x = 1 - x;
    const data = { type: 'pointer', x, y: (event.clientY - box.top - bounds.top) / bounds.height, author: id };
    receivePointer(data, id); sendPointer(data);
  });
  video.addEventListener('loadedmetadata', layout);
  video.addEventListener('playing', () => { $('#shareEmpty').hidden = true; if (viewer) setStatus('connected'); });
  window.addEventListener('resize', layout); document.addEventListener('fullscreenchange', layout);
  document.body.classList.toggle('viewer', viewer); $('#hostControls').hidden = viewer; $('#shareLinksPanel').hidden = viewer;
  if (viewer) {
    document.title = `CineWall · Shared Screen ${screen}`;
    const bar = document.querySelector('.share-player-bar');
    document.addEventListener('pointermove', () => { bar.classList.add('show'); clearTimeout(barTimer); barTimer = setTimeout(() => bar.classList.remove('show'), 2800); });
  } else if (!navigator.mediaDevices?.getDisplayMedia) error('Start sharing in desktop Chrome or Edge. Use the HTTPS website, or localhost on the laptop running CineWall.');
  void register().catch(problem => error(problem.message));
  setInterval(async () => {
    if (leaving) return;
    try { applyState(await api('ping', { status })); }
    catch (problem) { if (problem.status === 403) { current = null; stateVersion = ''; closeConnections(); await register().catch(() => {}); } else { setStatus('disconnected'); error('Connection lost. Reconnecting…'); } }
  }, 5000);
  window.addEventListener('pagehide', () => { leaving = true; events?.close(); closeConnections(); releaseCapture(); void api('leave', { }).catch(() => {}); });
  window.addEventListener('pageshow', event => { if (event.persisted) { leaving = false; current = null; stateVersion = ''; void register().catch(problem => error(problem.message)); } });
})();
