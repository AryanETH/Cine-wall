'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const params = new URL(location.href).searchParams;
  const slot = Number(params.get('speaker'));
  const role = params.get('role') === 'phone' ? 'phone' : Number.isInteger(slot) && slot >= 1 && slot <= 3 ? 'speaker' : '';
  const id = crypto.randomUUID?.() || '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
  const connections = new Map(), pendingCandidates = new Map(), recordUrls = new Set(), unsaved = new Map();
  const player = $('#phonePlayer'), preview = $('#prompterViewport');
  let state = null, events = null, registered = false, joining = null, leaving = false, networkBusy = false, laptopRemoved = false, changingLaptops = false;
  let remoteOrigin = location.origin, localNetwork = !window.CineWallSession.hosted;
  let context, bus, output, voiceOutput, micGain, sendGain, analyser, microphone, micSource, fileSource;
  let broadcasting = false, micStarting = false, fileUrl = '', status = 'waiting', signalQueue = Promise.resolve();
  let speakerEnabled = false, speakerMuted = false, speakerOutput;
  let recorder = null, recordStarting = false, recordStarted = 0, recordTimer, recordDuration = 0, saving = false;
  let scrolling = false, scrollFrame, scrollLast = 0, scrollPosition = 0, wakeLock = null;
  let iceServers = [];
  const incomingAudio = new Audio(); incomingAudio.autoplay = false; incomingAudio.playsInline = true;
  incomingAudio.volume = 1;

  function showError(message = '') { $('#micError').textContent = message; $('#micError').hidden = !message; }
  function badge(text, online = false) { $('#roomConnection').textContent = text; $('#roomConnection').classList.toggle('online', online); }
  function message(error) {
    if (error.name === 'NotAllowedError') return 'Microphone permission was denied. Allow microphone access in your browser’s site settings, then try again.';
    if (error.name === 'NotFoundError') return 'No microphone was found. Check your phone’s microphone and try again.';
    if (error.name === 'NotReadableError') return 'The microphone is busy. Close other apps using it, then try again.';
    return error.message || 'Something went wrong. Try again.';
  }
  async function api(action, body = {}) {
    const response = await fetch(`/api/mic/${action}`, { method: 'POST', keepalive: action === 'leave', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, peerId: id }) });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error || 'Could not connect.'), { status: response.status });
    return value;
  }
  const link = (suffix, origin = remoteOrigin) => window.CineWallSession.link(`/mic.html${suffix}`, origin);
  const labels = { waiting: 'Waiting', connecting: 'Connecting', connected: 'Connected', tap: 'Enable speaker', disconnected: 'Reconnecting' };

  function renderLinks() {
    const active = state?.laptops || [1];
    for (const n of [1, 2, 3]) if (!active.includes(n)) document.getElementById(`speaker-${n}`)?.remove();
    const roles = [{ role: 'phone', slot: 0, title: 'Phone mic', suffix: '?role=phone' }, ...active.map(n => ({ role: 'speaker', slot: n, title: `Laptop ${n}`, suffix: `?speaker=${n}` }))];
    let cardIndex = 0;
    for (const device of roles) {
      const key = `${device.role}-${device.slot}`;
      let card = document.getElementById(key);
      if (!card) {
        card = document.createElement('article'); card.id = key; card.className = 'mic-device';
        const heading = document.createElement('header'), title = document.createElement('strong'), note = document.createElement('small');
        title.textContent = device.title; heading.append(title, note);
        const input = document.createElement('input'); input.readOnly = true; input.hidden = true; input.setAttribute('aria-label', `${device.title} link`); input.addEventListener('click', () => input.select());
        const actions = document.createElement('div'); actions.className = 'mic-device-actions';
        const copy = document.createElement('button'); copy.className = 'mic-text-button'; copy.type = 'button'; copy.textContent = 'Copy link';
        copy.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(input.value); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy link'; }, 1800); }
          catch { input.hidden = false; input.focus(); input.select(); }
        });
        const open = document.createElement('a'); open.textContent = 'Open'; actions.append(copy, open);
        if (device.role === 'speaker') {
          const remove = document.createElement('button'); remove.className = 'mic-text-button mic-remove-laptop'; remove.type = 'button'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove laptop ${device.slot}`);
          remove.addEventListener('click', () => { void changeLaptops('remove', device.slot); }); card.laptopRemoveButton = remove; actions.append(remove);
        }
        card.append(heading, input, actions); $('#deviceLinks').append(card);
      }
      const peer = state?.peers.find(p => p.role === device.role && p.slot === device.slot);
      card.querySelector('small').textContent = peer ? peer.online ? device.role === 'phone' ? peer.live ? 'Live' : 'Connected' : labels[peer.status] : 'Reconnecting' : 'Offline';
      card.querySelector('input').value = link(device.suffix); card.querySelector('a').href = link(device.suffix, location.origin);
      if (card.laptopRemoveButton) card.laptopRemoveButton.disabled = changingLaptops;
      const container = $('#deviceLinks');
      if (container.children[cardIndex] !== card) container.insertBefore(card, container.children[cardIndex] || null);
      cardIndex++;
    }
    $('#phoneRole').href = link('?role=phone', location.origin);
    const free = active.find(n => !state?.peers.some(p => p.role === 'speaker' && p.slot === n)) || active[0];
    $('#speakerRole').href = link(`?speaker=${free}`, location.origin);
    $('#speakerRole').hidden = !active.length;
    $('#roomSummary').textContent = `${active.length}/3 laptops`;
    $('#addLaptop').disabled = !state || changingLaptops || active.length >= 3;
    $('#addLaptop').textContent = active.length >= 3 ? '3 laptops max' : '+ Add laptop';
  }
  async function changeLaptops(action, targetSlot) {
    if (changingLaptops) return;
    changingLaptops = true; renderLinks(); showError();
    try { applyState(await api('laptops', { action, slot: targetSlot })); }
    catch (error) { showError(message(error)); }
    finally { changingLaptops = false; renderLinks(); }
  }
  function detachLaptop() {
    laptopRemoved = true; registered = false; events?.close(); closeConnections();
    incomingAudio.pause(); speakerOutput?.source?.disconnect(); speakerEnabled = false;
    $('#enableSpeaker').hidden = true; $('#speakerTitle').textContent = 'Laptop removed'; $('#speakerMessage').textContent = '';
    badge('Removed');
  }
  async function join() {
    if (!role || leaving || laptopRemoved) return;
    if (joining) return joining;
    joining = (async () => {
      const value = await api('join', { role, slot }); registered = true;
      $('#toggleMic').disabled = micStarting || recordStarting;
      $('#startRecord').disabled = recordStarting || saving || recorder?.state === 'recording';
      events?.close();
      events = new EventSource(`/mic-events?peer=${id}&token=${encodeURIComponent(value.token)}`);
      events.addEventListener('mic-state', e => applyState(JSON.parse(e.data)));
      events.addEventListener('mic-removed', () => {
        if (state) { state.laptops = (state.laptops || [1]).filter(n => n !== slot); state.peers = state.peers.filter(p => p.peerId !== id); renderLinks(); }
        detachLaptop();
      });
      events.addEventListener('mic-signal', e => { signalQueue = signalQueue.then(() => receiveSignal(JSON.parse(e.data))).catch(error => { if (!leaving) showError(message(error)); }); });
      events.onopen = () => { if (laptopRemoved) return; badge('Connected', true); showError(); };
      events.onerror = () => { badge('Reconnecting…'); for (const p of connections.values()) p.pc.close(); connections.clear(); };
      applyState(value.state);
    })().finally(() => { joining = null; });
    return joining;
  }
  function closeConnections() { for (const p of connections.values()) p.pc.close(); connections.clear(); pendingCandidates.clear(); incomingAudio.srcObject = null; }
  function setStatus(next) { status = next; }
  function applyState(next) {
    if (leaving) return;
    if (state && state.version !== next.version) closeConnections();
    state = next; renderLinks();
    if (role === 'speaker' && !(next.laptops || [1]).includes(slot)) { detachLaptop(); return; }
    if (laptopRemoved) return;
    if (!role || !registered) return;
    const me = next.peers.find(p => p.peerId === id);
    if (!me) { registered = false; closeConnections(); void join().catch(e => showError(message(e))); return; }
    const phone = next.peers.find(p => p.role === 'phone' && p.online);
    const eligible = next.peers.filter(p => p.peerId !== id && p.online && p.role !== role);
    const wanted = new Set(eligible.map(p => p.peerId));
    for (const [key, p] of connections) if (!wanted.has(key)) { p.pc.close(); connections.delete(key); if (role === 'speaker') incomingAudio.srcObject = null; }
    if (role === 'phone' && output) for (const peer of eligible) if (!connections.has(peer.peerId)) void offer(peer.peerId).catch(e => { closePeer(peer.peerId); showError(message(e)); });
    if (role === 'speaker') {
      $('#speakerTitle').textContent = !phone ? 'Waiting for phone' : phone.live ? 'Live' : 'Phone connected';
      $('#speakerMessage').textContent = phone && speakerEnabled && !incomingAudio.srcObject ? 'Connecting audio…' : '';
    }
  }
  function closePeer(peerId) { const p = connections.get(peerId); p?.pc.close(); connections.delete(peerId); }
  function createConnection(peerId) {
    const pc = new RTCPeerConnection({ iceServers: localNetwork ? [] : iceServers });
    const entry = { pc, candidates: pendingCandidates.get(peerId) || [], remote: new MediaStream(), generation: state.version };
    pendingCandidates.delete(peerId);
    connections.set(peerId, entry);
    pc.onicecandidate = event => { if (event.candidate && connections.get(peerId) === entry) void api('signal', { to: peerId, version: entry.generation, candidate: event.candidate.toJSON() }).catch(() => {}); };
    pc.onconnectionstatechange = () => {
      if (connections.get(peerId) !== entry) return;
      if (pc.connectionState === 'connected') { if (role === 'speaker') setStatus(speakerEnabled ? 'connected' : 'tap'); showError(); }
      if (pc.connectionState === 'failed') { closePeer(peerId); setStatus('disconnected'); }
      if (pc.connectionState === 'disconnected') setStatus('disconnected');
    };
    pc.ontrack = event => {
      if (role !== 'speaker' || connections.get(peerId) !== entry || event.track.kind !== 'audio') return;
      if ('playoutDelayHint' in event.receiver) event.receiver.playoutDelayHint = 0;
      if ('jitterBufferTarget' in event.receiver) event.receiver.jitterBufferTarget = 0;
      entry.remote.addTrack(event.track); incomingAudio.srcObject = entry.remote;
      if (speakerEnabled) void playSpeaker().catch(e => { speakerEnabled = false; setStatus('tap'); $('#enableSpeaker').hidden = false; showError(message(e)); });
    };
    if (role === 'phone') for (const track of output.stream.getAudioTracks()) pc.addTrack(track, output.stream);
    return entry;
  }
  async function offer(peerId) {
    const entry = createConnection(peerId);
    await entry.pc.setLocalDescription(await entry.pc.createOffer());
    if (connections.get(peerId) === entry) await api('signal', { to: peerId, version: entry.generation, description: entry.pc.localDescription.toJSON() });
  }
  async function receiveSignal(data) {
    if (data.version !== state?.version || !state.peers.some(p => p.peerId === data.from && p.role !== role && p.online)) return;
    let entry = connections.get(data.from);
    if (data.description?.type === 'offer') { if (role !== 'speaker') return; closePeer(data.from); entry = createConnection(data.from); }
    if (!entry) {
      if (data.candidate) { const candidates = pendingCandidates.get(data.from) || []; if (candidates.length < 100) candidates.push(data.candidate); pendingCandidates.set(data.from, candidates); }
      return;
    }
    if (data.description) {
      await entry.pc.setRemoteDescription(data.description);
      for (const candidate of entry.candidates.splice(0)) await entry.pc.addIceCandidate(candidate);
      if (data.description.type === 'offer') {
        await entry.pc.setLocalDescription(await entry.pc.createAnswer());
        await api('signal', { to: data.from, version: state.version, description: entry.pc.localDescription.toJSON() });
      }
    } else if (data.candidate) {
      if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(data.candidate); else entry.candidates.push(data.candidate);
    }
  }
  async function setupAudio() {
    if (!context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('This browser does not support live audio. Try a current Chrome, Edge or Safari browser.');
      context = new AudioContext({ latencyHint: 'interactive' }); bus = context.createDynamicsCompressor();
      bus.threshold.value = -6; bus.knee.value = 10; bus.ratio.value = 8;
      output = context.createMediaStreamDestination(); voiceOutput = context.createMediaStreamDestination();
      micGain = context.createGain(); micGain.gain.value = Number($('#micBoost').value);
      sendGain = context.createGain(); sendGain.gain.value = 0;
      const voiceLimiter = context.createDynamicsCompressor(); voiceLimiter.threshold.value = -6; voiceLimiter.ratio.value = 8;
      micGain.connect(sendGain); sendGain.connect(bus); micGain.connect(voiceLimiter); voiceLimiter.connect(voiceOutput); bus.connect(output);
      analyser = context.createAnalyser(); analyser.fftSize = 256; micGain.connect(analyser);
      fileSource = context.createMediaElementSource(player); fileSource.connect(bus);
      updateMeter();
    }
    await context.resume();
    if (context.state !== 'running') throw new Error('Tap the audio button again to allow this browser to start sound.');
    if (!registered) await join();
    if (state) applyState(state);
  }
  function updateMeter() {
    if (leaving) return;
    const samples = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, n) => sum + ((n - 128) / 128) ** 2, 0) / samples.length);
    $('#micLevel').style.width = `${Math.min(100, rms * 250)}%`;
    requestAnimationFrame(updateMeter);
  }
  async function getMic() {
    if (microphone?.getAudioTracks().some(t => t.readyState === 'live')) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Open this page over trusted HTTPS to use the phone microphone. See Connection & HTTPS help.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }, video: false });
    if (leaving) { stream.getTracks().forEach(t => t.stop()); throw new Error('This device has disconnected.'); }
    microphone = stream; micSource = context.createMediaStreamSource(stream); micSource.connect(micGain);
    stream.getAudioTracks()[0].onended = () => { stopMic(); showError('The microphone stopped. Keep the phone awake, then turn it on again.'); };
    renderMic();
  }
  async function wake() { try { if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch {} }
  async function updateLive() {
    const live = broadcasting || (!player.paused && Boolean(fileUrl));
    if (live || recorder?.state === 'recording') void wake();
    else if (wakeLock) { void wakeLock.release(); wakeLock = null; }
    if (registered && !leaving) try { applyState(await api('live', { live })); } catch (e) { showError(message(e)); }
  }
  function renderMic() {
    const on = Boolean(microphone);
    $('#toggleMic').textContent = on ? 'Mic off' : 'Mic on';
    $('#muteMic').disabled = !on; $('#muteMic').textContent = broadcasting ? 'Mute' : 'Unmute';
    $('#phoneState').textContent = broadcasting ? 'Mic live' : on ? 'Mic muted' : 'Mic off';
    $('#phoneState').classList.toggle('online', broadcasting);
  }
  function stopMic() {
    if (recorder?.state === 'recording') stopRecording();
    broadcasting = false; if (sendGain) sendGain.gain.value = 0;
    const old = microphone; microphone = null; micSource?.disconnect(); micSource = null;
    old?.getTracks().forEach(track => { track.onended = null; track.stop(); }); renderMic(); void updateLive();
  }
  $('#toggleMic').addEventListener('click', async () => {
    if (microphone) { stopMic(); return; }
    if (micStarting || recordStarting) return;
    micStarting = true; $('#toggleMic').disabled = true; showError();
    try { await setupAudio(); await getMic(); broadcasting = true; sendGain.gain.value = 1; renderMic(); await updateLive(); }
    catch (error) { showError(message(error)); }
    finally { micStarting = false; $('#toggleMic').disabled = !registered; }
  });
  $('#muteMic').addEventListener('click', () => { broadcasting = !broadcasting; sendGain.gain.value = broadcasting ? 1 : 0; renderMic(); void updateLive(); });
  $('#micBoost').addEventListener('input', e => { $('#boostValue').textContent = `${Number(e.target.value).toFixed(1)}×`; if (micGain) micGain.gain.value = Number(e.target.value); });
  $('#phoneAudio').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    showError();
    try {
      await setupAudio(); player.pause(); if (fileUrl) URL.revokeObjectURL(fileUrl);
      fileUrl = URL.createObjectURL(file); player.src = fileUrl; player.hidden = false; $('#removeAudio').hidden = false; $('#audioFileName').textContent = file.name; $('#audioFileName').hidden = false;
      await player.play();
    } catch (error) { showError(message(error)); }
  });
  player.addEventListener('play', () => { void setupAudio().then(updateLive).catch(e => { player.pause(); showError(message(e)); }); });
  for (const name of ['pause', 'ended']) player.addEventListener(name, () => { void updateLive(); });
  player.addEventListener('error', () => showError('This audio file could not play. Try an MP3, AAC or WAV file supported by your phone.'));
  $('#removeAudio').addEventListener('click', () => { player.pause(); player.removeAttribute('src'); player.load(); player.hidden = true; if (fileUrl) URL.revokeObjectURL(fileUrl); fileUrl = ''; $('#phoneAudio').value = ''; $('#audioFileName').textContent = ''; $('#audioFileName').hidden = true; $('#removeAudio').hidden = true; void updateLive(); });

  async function playSpeaker() {
    // Resume inside the click before waiting for a stream; Safari requires a gesture.
    if (!speakerOutput) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        const ctx = new AudioContext({ latencyHint: 'interactive' }), gain = ctx.createGain(); gain.connect(ctx.destination);
        speakerOutput = { context: ctx, gain, source: null, stream: null };
      }
    }
    if (speakerOutput) {
      await speakerOutput.context.resume();
      if (speakerOutput.context.state !== 'running') throw new Error('Tap Enable speaker again to allow sound.');
      if (incomingAudio.srcObject && speakerOutput.stream !== incomingAudio.srcObject) {
        speakerOutput.source?.disconnect(); speakerOutput.source = speakerOutput.context.createMediaStreamSource(incomingAudio.srcObject); speakerOutput.source.connect(speakerOutput.gain); speakerOutput.stream = incomingAudio.srcObject;
      }
      speakerOutput.gain.gain.value = speakerMuted ? 0 : Number($('#speakerVolume').value);
    } else if (incomingAudio.srcObject) await incomingAudio.play();
    incomingAudio.volume = Number($('#speakerVolume').value); incomingAudio.muted = speakerMuted;
    speakerEnabled = true; $('#enableSpeaker').hidden = true; setStatus(incomingAudio.srcObject ? 'connected' : 'waiting');
    if (state) applyState(state); void wake();
  }
  $('#enableSpeaker').addEventListener('click', () => { void playSpeaker().catch(e => showError(message(e))); });
  $('#speakerVolume').addEventListener('input', e => { incomingAudio.volume = Number(e.target.value); $('#volumeValue').textContent = `${Math.round(Number(e.target.value) * 100)}%`; if (speakerOutput) speakerOutput.gain.gain.value = speakerMuted ? 0 : Number(e.target.value); });
  $('#muteSpeaker').addEventListener('click', () => { speakerMuted = !speakerMuted; incomingAudio.muted = speakerMuted; if (speakerOutput) speakerOutput.gain.gain.value = speakerMuted ? 0 : Number($('#speakerVolume').value); $('#muteSpeaker').textContent = speakerMuted ? 'Unmute' : 'Mute'; });

  function loadScript() {
    try { $('#scriptText').value = localStorage.getItem('cinewall-mic-script') || ''; } catch {}
    $('#prompterText').textContent = $('#scriptText').value;
  }
  function pauseScroll() { scrolling = false; cancelAnimationFrame(scrollFrame); $('#scrollToggle').textContent = 'Start'; }
  function scrollTick(time) {
    if (!scrolling) return;
    if (scrollLast) { scrollPosition += Math.min(100, time - scrollLast) / 1000 * Number($('#scrollSpeed').value); preview.scrollTop = scrollPosition; }
    scrollLast = time;
    if (preview.scrollTop >= preview.scrollHeight - preview.clientHeight - 1) { pauseScroll(); return; }
    scrollFrame = requestAnimationFrame(scrollTick);
  }
  $('#scriptText').addEventListener('input', e => {
    pauseScroll(); $('#prompterText').textContent = e.target.value; preview.scrollTop = 0;
    try { localStorage.setItem('cinewall-mic-script', e.target.value); $('#scriptSaved').hidden = true; } catch { $('#scriptSaved').hidden = false; $('#scriptSaved').textContent = 'Script not saved.'; }
  });
  $('#scrollToggle').addEventListener('click', () => {
    if (scrolling) { pauseScroll(); return; }
    if (!$('#scriptText').value.trim()) { $('#scriptText').focus(); showError('Type or paste your script before starting the teleprompter.'); return; }
    if (preview.scrollTop >= preview.scrollHeight - preview.clientHeight - 1) preview.scrollTop = 0;
    $('#scriptEditor').open = false; scrolling = true; scrollLast = 0; scrollPosition = preview.scrollTop; $('#scrollToggle').textContent = 'Pause'; scrollFrame = requestAnimationFrame(scrollTick); void wake();
  });
  $('#resetScroll').addEventListener('click', () => { pauseScroll(); preview.scrollTop = 0; });
  for (const event of ['wheel', 'touchstart', 'keydown']) preview.addEventListener(event, pauseScroll, { passive: true });
  $('#scrollSpeed').addEventListener('input', e => { $('#speedValue').textContent = `${e.target.value} px/s`; });
  $('#fontSize').addEventListener('input', e => { $('#fontValue').textContent = `${e.target.value} px`; $('#prompterText').style.fontSize = `${e.target.value}px`; });
  $('#mirrorScript').addEventListener('click', e => { const mirrored = $('#prompterText').classList.toggle('mirrored'); e.target.setAttribute('aria-pressed', String(mirrored)); });
  function focusPrompter(focus) { $('#prompterPanel').classList.toggle('focused', focus); $('#focusPrompter').textContent = focus ? 'Close' : 'Focus'; if (focus) $('#scriptEditor').open = false; document.body.style.overflow = focus ? 'hidden' : ''; }
  $('#focusPrompter').addEventListener('click', () => focusPrompter(!$('#prompterPanel').classList.contains('focused')));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') focusPrompter(false); });

  let database;
  function db() {
    if (!database) database = new Promise((resolve, reject) => {
      const req = indexedDB.open('cinewall-voice-recordings', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('takes', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    return database;
  }
  async function store(action, value) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('takes', action === 'getAll' ? 'readonly' : 'readwrite');
      const req = tx.objectStore('takes')[action](...(value === undefined ? [] : [value]));
      tx.oncomplete = () => resolve(req.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Recording storage was interrupted.'));
    });
  }
  const formatTime = seconds => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
  async function renderRecordings() {
    let takes = [];
    try { takes = await store('getAll'); } catch { $('#recordStatus').hidden = false; $('#recordStatus').textContent = 'Storage unavailable. Download your recordings.'; }
    for (const url of recordUrls) URL.revokeObjectURL(url); recordUrls.clear();
    $('#recordings').replaceChildren();
    const merged = new Map(takes.map(take => [take.id, take])); for (const take of unsaved.values()) merged.set(take.id, take);
    for (const take of [...merged.values()].sort((a, b) => b.created - a.created)) {
      const item = document.createElement('article'); item.className = 'mic-recording';
      const title = document.createElement('strong'); title.textContent = take.name;
      const note = document.createElement('small'); note.textContent = `${formatTime(take.duration)} · ${(take.blob.size / 1024 / 1024).toFixed(2)} MB${unsaved.has(take.id) ? ' · Download before leaving' : ' · Saved on this device'}`;
      const url = URL.createObjectURL(take.blob); recordUrls.add(url);
      const audio = document.createElement('audio'); audio.controls = true; audio.src = url; audio.preload = 'metadata'; audio.setAttribute('aria-label', `Preview ${take.name}`);
      const actions = document.createElement('div'); actions.className = 'mic-device-actions';
      const download = document.createElement('a'); download.href = url; download.download = `cinewall-voice-${new Date(take.created).toISOString().replace(/[:.]/g, '-')}.${take.blob.type.includes('mp4') ? 'm4a' : take.blob.type.includes('ogg') ? 'ogg' : 'webm'}`; download.textContent = 'Download';
      const remove = document.createElement('button'); remove.className = 'mic-text-button'; remove.type = 'button'; remove.textContent = 'Delete'; remove.setAttribute('aria-label', `Delete ${take.name}`);
      remove.addEventListener('click', async () => {
        try { if (!unsaved.has(take.id)) await store('delete', take.id); unsaved.delete(take.id); audio.pause(); await renderRecordings(); }
        catch (e) { showError(`Could not delete this recording: ${message(e)}`); }
      });
      actions.append(download, remove); item.append(title, note, audio, actions); $('#recordings').append(item);
    }
  }
  $('#startRecord').addEventListener('click', async () => {
    if (recordStarting || micStarting || saving || recorder?.state === 'recording') return;
    recordStarting = true; $('#startRecord').disabled = true; showError();
    try {
      if (!window.MediaRecorder) throw new Error('Voice recording is unavailable in this browser. Try a current Chrome, Safari or Edge browser.');
      await setupAudio(); await getMic();
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      const takeRecorder = new MediaRecorder(voiceOutput.stream, mimeType ? { mimeType } : {}), chunks = [];
      recorder = takeRecorder;
      takeRecorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      takeRecorder.onerror = event => { showError(message(event.error || new Error('Recording was interrupted.'))); if (takeRecorder.state === 'recording') stopRecording(); };
      takeRecorder.onstop = async () => {
        saving = true; $('#startRecord').disabled = true; $('#stopRecord').disabled = true;
        const blob = new Blob(chunks, { type: takeRecorder.mimeType || chunks[0]?.type || 'audio/webm' });
        if (blob.size) {
          const take = { id: crypto.getRandomValues(new Uint32Array(4)).join('-'), created: recordStarted, name: `Voice take · ${new Date(recordStarted).toLocaleString()}`, duration: recordDuration, blob };
          try { await store('put', take); $('#recordStatus').textContent = 'Saved'; }
          catch { unsaved.set(take.id, take); $('#recordStatus').textContent = 'Not saved. Download to keep.'; }
          await renderRecordings();
        } else showError('No audio was recorded. Check your microphone and try again.');
        saving = false; recorder = null; $('#startRecord').disabled = !registered; void updateLive();
      };
      takeRecorder.start(1000); recordStarted = Date.now(); recordDuration = 0;
      $('#recordTime').textContent = '00:00'; $('#recordTime').classList.add('recording'); $('#stopRecord').disabled = false;
      $('#recordStatus').hidden = false; $('#recordStatus').textContent = 'Recording…';
      recordTimer = setInterval(() => { $('#recordTime').textContent = formatTime((Date.now() - recordStarted) / 1000); }, 250); void wake(); renderMic();
    } catch (error) { showError(message(error)); $('#startRecord').disabled = !registered; }
    finally { recordStarting = false; }
  });
  function stopRecording() {
    if (!recorder || recorder.state !== 'recording') return;
    recordDuration = (Date.now() - recordStarted) / 1000; clearInterval(recordTimer); recorder.stop();
    $('#recordTime').classList.remove('recording'); $('#recordTime').textContent = formatTime(recordDuration); $('#stopRecord').disabled = true; $('#recordStatus').textContent = 'Saving…';
  }
  $('#stopRecord').addEventListener('click', stopRecording);

  async function disconnect() {
    if (recordStarting || saving || recorder?.state === 'recording' || unsaved.size) { showError('Stop recording and download any unsaved takes before disconnecting.'); return; }
    leaving = true; events?.close(); closeConnections(); player.pause(); stopMic(); pauseScroll();
    if (registered) try { await api('leave'); } catch {}
    registered = false; context?.close(); speakerOutput?.context.close(); if (wakeLock) void wakeLock.release();
    location.href = link('', location.origin);
  }
  $('#leaveRoom').addEventListener('click', () => { void disconnect(); });
  $('#addLaptop').addEventListener('click', () => { void changeLaptops('add'); });
  $('#networkAddress').addEventListener('change', e => { remoteOrigin = e.target.value; renderLinks(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (broadcasting || scrolling || speakerEnabled || recorder?.state === 'recording')) void wake(); });
  window.addEventListener('beforeunload', e => { if (recordStarting || saving || recorder?.state === 'recording' || unsaved.size) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('pagehide', () => {
    leaving = true; events?.close(); closeConnections(); player.pause(); stopMic(); pauseScroll();
    if (registered) void api('leave').catch(() => {});
    context?.close(); speakerOutput?.context.close(); if (wakeLock) void wakeLock.release();
    for (const url of recordUrls) URL.revokeObjectURL(url); if (fileUrl) URL.revokeObjectURL(fileUrl);
  });
  // A back/forward-cache restore must establish fresh capture and room identity.
  window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });

  async function heartbeat() {
    if (leaving || laptopRemoved || networkBusy || joining) return;
    networkBusy = true;
    try {
      if (role) {
        if (!registered) await join();
        else applyState(await api('ping', { status }));
        if (role === 'phone' && registered && state?.peers.find(p => p.peerId === id)?.live !== (broadcasting || (!player.paused && Boolean(fileUrl)))) await updateLive();
      } else { const response = await fetch('/api/mic/state', { cache: 'no-store' }); const result = await response.json(); if (!response.ok) throw new Error(result.error); applyState(result); badge('Ready', true); }
    } catch (error) { if (error.status === 410 && role === 'speaker') { detachLaptop(); return; } badge('Connection lost'); if (error.status === 403) { registered = false; events?.close(); closeConnections(); } showError(message(error)); }
    finally { networkBusy = false; }
  }
  async function init() {
    document.body.dataset.role = role;
    $('#chooseRole').hidden = Boolean(role); $('#phonePanel').hidden = role !== 'phone'; $('#prompterPanel').hidden = role !== 'phone'; $('#recordPanel').hidden = role !== 'phone'; $('#speakerPanel').hidden = role !== 'speaker'; $('#leaveRoom').hidden = !role;
    $('#secureNotice').hidden = window.isSecureContext;
    if (role === 'speaker') { $('#speakerLabel').textContent = `LAPTOP ${slot}`; $('.mic-heading h1').textContent = `Laptop ${slot}`; }
    if (role) { $('#toggleMic').disabled = true; $('#startRecord').disabled = true; }
    loadScript(); renderLinks();
    try {
      const response = await fetch('/api/info', { cache: 'no-store' }); const info = await response.json();
      if (!response.ok) throw new Error(info.error);
      iceServers = info.iceServers || []; localNetwork = !info.hosted;
      if (!info.hosted && info.addresses?.length) {
        const origins = [...new Set(info.addresses.map(address => `${location.protocol}//${address}:${info.port}`))];
        if (!origins.includes(location.origin)) origins.unshift(location.origin);
        for (const origin of origins) { const option = document.createElement('option'); option.value = origin; option.textContent = origin; $('#networkAddress').append(option); }
        remoteOrigin = origins.find(origin => !/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(origin)) || location.origin; $('#networkAddress').value = remoteOrigin; $('#networkLabel').hidden = false;
      }
    } catch (error) { showError(message(error)); }
    await heartbeat();
    if (role) { $('#toggleMic').disabled = !registered; $('#startRecord').disabled = !registered; }
    if (role === 'phone') void renderRecordings();
    setInterval(() => { void heartbeat(); }, 3000);
  }
  void init();
})();
