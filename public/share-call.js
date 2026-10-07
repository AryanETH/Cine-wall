'use strict';

// A separate peer-to-peer call, so stopping screen capture does not end the call.
function createRoomCall({ id, api, getInviteLink = () => window.CineWallSession.link('/share.html') }) {
  const $ = selector => document.querySelector(selector);
  const tracks = new Map(), connections = new Map(), tiles = new Map();
  const local = new MediaStream();
  const screen = Number(new URL(location.href).searchParams.get('screen') || 0);
  let state = null, joined = false, busy = false, generation = 0;

  function showError(message = '') { $('#callError').hidden = !message; $('#callError').textContent = message; }
  function eligible() { return state && (screen === 0 || screen <= state.settings.count); }
  function members() { return state?.participants || []; }
  function label(peer) { return peer.peerId === id ? 'You' : peer.peerId === state?.source?.peerId ? 'Presenter' : peer.screen === 0 ? 'Guest' : `Screen ${peer.screen}`; }
  function active(kind) { return tracks.get(kind)?.readyState === 'live'; }
  function controls() {
    const allowed = eligible() && typeof RTCPeerConnection !== 'undefined';
    $('#callJoin').disabled = !allowed || (busy && !joined);
    $('#callJoin').textContent = joined ? 'Leave call' : 'Join call';
    $('#callJoin').classList.toggle('danger', joined);
    for (const [kind, selector, title] of [['audio', '#callMic', 'Mic'], ['video', '#callCamera', 'Camera']]) {
      const button = $(selector), on = active(kind);
      button.disabled = !allowed || busy || !navigator.mediaDevices?.getUserMedia;
      button.setAttribute('aria-pressed', String(on));
      button.classList.toggle('active', on);
      button.querySelector('span').textContent = `${title} ${on ? 'on' : 'off'}`;
    }
    $('#callStatus').textContent = !eligible() ? 'Waiting for this screen to join the room.' : joined ? `${members().length} in the call · Your mic is ${active('audio') ? 'on' : 'off'}` : 'Join to talk or listen. Mic and camera start off.';
  }
  function closePeer(peerId) {
    const connection = connections.get(peerId);
    if (connection) { connection.pc.close(); connections.delete(peerId); }
    const tile = tiles.get(peerId);
    if (tile) { tile.video.srcObject = null; tile.element.remove(); tiles.delete(peerId); }
  }
  function reset() {
    generation++; joined = false; busy = false;
    for (const peerId of [...connections.keys()]) closePeer(peerId);
    for (const track of tracks.values()) track.stop();
    tracks.clear(); local.getTracks().forEach(track => local.removeTrack(track));
    for (const tile of tiles.values()) { tile.video.srcObject = null; tile.element.remove(); }
    tiles.clear(); $('#callListen').hidden = true; controls();
  }
  function render() {
    const visible = joined ? members() : [];
    for (const peerId of [...tiles.keys()]) if (!visible.some(peer => peer.peerId === peerId)) closePeer(peerId);
    for (const peer of visible) {
      let tile = tiles.get(peer.peerId);
      if (!tile) {
        const element = document.createElement('article'); element.className = 'share-call-tile';
        const video = document.createElement('video'); video.autoplay = true; video.playsInline = true; video.muted = peer.peerId === id;
        const avatar = document.createElement('div'); avatar.className = 'share-call-avatar';
        const caption = document.createElement('div'); caption.className = 'share-call-caption';
        const name = document.createElement('strong'), note = document.createElement('span'); caption.append(name, note);
        element.append(video, avatar, caption); $('#callTiles').append(element);
        tile = { element, video, avatar, name, note }; tiles.set(peer.peerId, tile);
      }
      tile.name.textContent = label(peer); tile.avatar.textContent = peer.peerId === id ? 'You' : peer.screen === 0 ? 'P' : peer.screen;
      tile.video.hidden = !peer.camera; tile.avatar.hidden = peer.camera;
      const pc = connections.get(peer.peerId)?.pc;
      const connected = peer.peerId === id || pc?.connectionState === 'connected';
      tile.note.textContent = `${connected ? peer.mic ? 'Mic on' : 'Mic off' : 'Connecting…'} · ${peer.camera ? 'Camera on' : 'Camera off'}`;
      if (peer.peerId === id) {
        if (tile.video.srcObject !== local) tile.video.srcObject = local;
        if (active('video')) void tile.video.play().catch(() => {});
      }
    }
    controls();
  }
  async function playRemote(tile) {
    try { await tile.video.play(); }
    catch { $('#callListen').hidden = false; }
  }
  function makeConnection(peerId) {
    const pc = new RTCPeerConnection({ iceServers: [] });
    const connection = { pc, version: state.callVersion, polite: id > peerId, makingOffer: false, ignoreOffer: false, pendingAnswer: false, candidates: [], queue: Promise.resolve(), remote: new MediaStream(), senders: {} };
    connections.set(peerId, connection);
    for (const kind of ['audio', 'video']) {
      const sender = pc.addTransceiver(kind, { direction: 'sendrecv' }).sender;
      connection.senders[kind] = sender;
      void sender.replaceTrack(tracks.get(kind) || null).catch(() => {});
    }
    const signal = body => api('call-signal', { ...body, to: peerId, version: connection.version });
    pc.onicecandidate = event => { if (event.candidate && pc.connectionState !== 'closed') void signal({ candidate: event.candidate.toJSON() }).catch(() => {}); };
    pc.onnegotiationneeded = async () => {
      try {
        connection.makingOffer = true;
        await pc.setLocalDescription();
        await signal({ description: pc.localDescription.toJSON() });
      } catch { closePeer(peerId); }
      finally { connection.makingOffer = false; }
    };
    pc.ontrack = event => {
      const tile = tiles.get(peerId);
      if (!tile || !joined || connections.get(peerId) !== connection) return;
      window.CineWallShareMedia?.tuneReceiver(event.receiver);
      if (!connection.remote.getTracks().some(track => track.id === event.track.id)) connection.remote.addTrack(event.track);
      tile.video.srcObject = connection.remote;
      void playRemote(tile);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') closePeer(peerId);
      if (pc.connectionState === 'connected') for (const sender of Object.values(connection.senders)) {
        void window.CineWallShareMedia?.tuneSender(sender, sender.track?.kind === 'audio' ? { bitrate: 64000 } : { bitrate: 500000, fps: 20 });
      }
      render();
    };
    return connection;
  }
  async function onSignal(data) {
    if (!joined || data.version !== state?.callVersion || !members().some(peer => peer.peerId === data.from)) return;
    const connection = connections.get(data.from) || makeConnection(data.from);
    const pc = connection.pc;
    connection.queue = connection.queue.then(async () => {
      if (pc.connectionState === 'closed') return;
      if (data.description) {
        const ready = !connection.makingOffer && (pc.signalingState === 'stable' || connection.pendingAnswer);
        const collision = data.description.type === 'offer' && !ready;
        connection.ignoreOffer = !connection.polite && collision;
        if (connection.ignoreOffer) return;
        connection.pendingAnswer = data.description.type === 'answer';
        await pc.setRemoteDescription(data.description);
        connection.pendingAnswer = false;
        for (const candidate of connection.candidates.splice(0)) await pc.addIceCandidate(candidate);
        if (data.description.type === 'offer') {
          await pc.setLocalDescription();
          await api('call-signal', { to: data.from, version: connection.version, description: pc.localDescription.toJSON() });
        }
      } else if (data.candidate && !connection.ignoreOffer) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
        else if (connection.candidates.length < 128) connection.candidates.push(data.candidate);
      }
    }).catch(() => { closePeer(data.from); });
    return connection.queue;
  }
  function updateState(next) {
    if (state && next.callVersion === state.callVersion && next.revision < state.revision) return;
    if (state && (next.callVersion !== state.callVersion || !next.participants?.some(peer => peer.peerId === id)) && joined) reset();
    state = next;
    joined = members().some(peer => peer.peerId === id);
    if (!eligible() && joined) reset();
    for (const peerId of [...connections.keys()]) if (!joined || !members().some(peer => peer.peerId === peerId)) closePeer(peerId);
    render();
    if (joined) for (const peer of members()) if (peer.peerId !== id && peer.online && !connections.has(peer.peerId)) makeConnection(peer.peerId);
  }
  async function publish() { updateState(await api('call-media', { joined, mic: Boolean(active('audio')), camera: Boolean(active('video')) })); }
  async function join() {
    if (!joined) updateState(await api('call-media', { joined: true, mic: false, camera: false }));
  }
  async function replace(kind) {
    await Promise.all([...connections.values()].map(connection => connection.senders[kind].replaceTrack(tracks.get(kind) || null).catch(() => {})));
    await Promise.all([...connections.values()].map(connection => window.CineWallShareMedia?.tuneSender(connection.senders[kind], kind === 'audio' ? { bitrate: 64000 } : { bitrate: 500000, fps: 20 })));
  }
  async function drop(kind) {
    const track = tracks.get(kind);
    tracks.delete(kind);
    if (track) { local.removeTrack(track); track.stop(); }
    await replace(kind);
  }
  async function toggle(kind) {
    if (busy || !eligible()) return;
    busy = true; controls(); showError();
    const token = generation;
    let capture;
    try {
      await join();
      if (token !== generation) return;
      if (active(kind)) await drop(kind);
      else {
        capture = await navigator.mediaDevices.getUserMedia(kind === 'audio'
          ? { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }
          : { video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 20, max: 24 }, facingMode: 'user' }, audio: false });
        if (token !== generation || !joined) { capture.getTracks().forEach(track => track.stop()); return; }
        const track = capture.getTracks().find(item => item.kind === kind);
        if (!track) throw new Error('This device is not available.');
        tracks.set(kind, track); local.addTrack(track);
        track.addEventListener('ended', () => { if (tracks.get(kind) === track) void drop(kind).then(publish).catch(() => {}); });
        await replace(kind);
      }
      if (token === generation) await publish();
    } catch (problem) {
      capture?.getTracks().forEach(track => track.stop());
      if (token === generation) {
        await drop(kind);
        if (joined) await publish().catch(() => {});
        showError(problem.name === 'NotAllowedError' ? 'Access was blocked. Allow your mic or camera in the browser, then try again.' : problem.name === 'NotFoundError' ? 'No microphone or camera was found.' : problem.message || 'Could not turn on this device.');
      }
    } finally { if (token === generation) { busy = false; render(); } }
  }
  $('#callJoin').addEventListener('click', async () => {
    showError();
    if (joined) { reset(); try { await api('call-media', { joined: false, mic: false, camera: false }); } catch (problem) { showError(problem.message); } }
    else {
      busy = true; controls();
      try { await join(); } catch (problem) { showError(problem.message); }
      finally { busy = false; render(); }
    }
  });
  $('#callMic').addEventListener('click', () => { void toggle('audio'); });
  $('#callCamera').addEventListener('click', () => { void toggle('video'); });
  $('#callListen').addEventListener('click', async () => {
    $('#callListen').hidden = true;
    await Promise.all([...tiles.entries()].filter(([peerId]) => peerId !== id).map(([, tile]) => playRemote(tile)));
  });
  $('#callCopy').addEventListener('click', async () => {
    const link = getInviteLink();
    try { await navigator.clipboard.writeText(link); $('#callCopy').textContent = 'Link copied'; }
    catch { showError(`Share this room link: ${link}`); }
  });
  if (!navigator.mediaDevices?.getUserMedia) showError('For mic and camera, open watch.aitoyz.in on every laptop and use the same room link.');
  controls();
  return { updateState, onSignal, close: reset };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createRoomCall;
else window.CineWallCall = createRoomCall;
