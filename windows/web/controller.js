'use strict';
(() => {
  const get = id => document.getElementById(id);
  const pair = get('pair');
  const code = get('code');
  const status = get('status');
  const cancel = get('cancel');
  const viewer = get('viewer');
  const monitor = get('monitor');
  const stage = get('stage');
  const desktop = get('desktop');
  const token = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
  let socket;
  let active = false;
  let frameMonitor = -1;
  let sentMonitor = -1;
  let currentUrl;
  let pending = [];
  let timer;
  let focused = false;
  let pointerCaptured = false;
  const held = new Map();

  function end(message) {
    const closing = socket;
    socket = undefined;
    closing?.close();
    clearTimeout(timer);
    if (document.fullscreenElement === stage) document.exitFullscreen().catch(() => {});
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = undefined;
    desktop.removeAttribute('src');
    active = false;
    frameMonitor = -1;
    pending = [];
    held.clear();
    viewer.hidden = true;
    pair.hidden = false;
    cancel.hidden = true;
    code.disabled = false;
    pair.querySelector('[type="submit"]').disabled = !token;
    status.textContent = message;
  }

  function release() {
    pending = [{ kind: 'release' }];
    held.clear();
  }

  function enqueue(item) {
    if (!active || frameMonitor !== Number(monitor.value)) return;
    if (pending.length >= 120) { release(); return; }
    if (item.kind === 'move' && pending.at(-1)?.kind === 'move') pending[pending.length - 1] = item;
    else pending.push(item);
  }

  function nextFrame(peer) {
    if (peer !== socket || !active || peer.readyState !== WebSocket.OPEN) return;
    sentMonitor = Number(monitor.value);
    peer.send(JSON.stringify({ monitor: sentMonitor, events: pending }));
    pending = [];
  }

  pair.addEventListener('submit', event => {
    event.preventDefault();
    if (!token || socket) return;
    const pairingCode = code.value.trim();
    code.value = '';
    code.disabled = true;
    pair.querySelector('[type="submit"]').disabled = true;
    cancel.hidden = false;
    status.textContent = 'Waiting for the host to approve this computer…';
    const peer = new WebSocket('ws://' + location.host + '/session');
    socket = peer;
    peer.onopen = () => peer.send(JSON.stringify({ token, code: pairingCode }));
    peer.onmessage = async event => {
      if (peer !== socket) return;
      if (typeof event.data === 'string') {
        const reply = JSON.parse(event.data);
        if (!reply.approved) { end(reply.reason); return; }
        monitor.replaceChildren(...reply.monitors.map((_, index) => new Option('Monitor ' + (index + 1), index)));
        active = true;
        pair.hidden = true;
        viewer.hidden = false;
        status.textContent = 'Remote control active · Click the desktop to send input.';
        nextFrame(peer);
        return;
      }
      if (sentMonitor === Number(monitor.value)) {
        const url = URL.createObjectURL(new Blob([event.data], { type: 'image/jpeg' }));
        desktop.src = url;
        try { await desktop.decode(); } catch {
          URL.revokeObjectURL(url);
          if (peer === socket) end('The desktop frame could not be displayed.');
          return;
        }
        if (peer !== socket) { URL.revokeObjectURL(url); return; }
        frameMonitor = sentMonitor;
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = url;
      }
      timer = setTimeout(() => nextFrame(peer), 65);
    };
    peer.onclose = () => { if (peer === socket) end('Connection ended. Get a fresh code, or reopen Remote Control from CineWall.'); };
    peer.onerror = () => { if (peer === socket) end('CineWall’s local controller is unavailable. Reopen Remote Control from CineWall.'); };
  });

  function pointer(event, kind, value) {
    const rect = desktop.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (!stage.hasPointerCapture(event.pointerId) && (x < 0 || x > 1 || y < 0 || y > 1)) return;
    enqueue({ kind, code: value, x: Math.round(Math.max(0, Math.min(1, x)) * 65535),
      y: Math.round(Math.max(0, Math.min(1, y)) * 65535) });
  }
  function button(event) { return [0, 2, 1][event.button]; }
  stage.addEventListener('pointerdown', event => {
    if (event.target !== desktop || button(event) === undefined) return;
    event.preventDefault();
    stage.focus();
    stage.setPointerCapture(event.pointerId);
    pointerCaptured = true;
    pointer(event, 'down', button(event));
  });
  stage.addEventListener('pointermove', event => {
    if (focused) pointer(event, 'move', 0);
  });
  stage.addEventListener('pointerup', event => {
    if (button(event) !== undefined) pointer(event, 'up', button(event));
    if (!event.buttons && stage.hasPointerCapture(event.pointerId)) {
      pointerCaptured = false;
      stage.releasePointerCapture(event.pointerId);
    }
  });
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('lostpointercapture', () => {
    if (pointerCaptured) release();
    pointerCaptured = false;
  });
  stage.addEventListener('contextmenu', event => event.preventDefault());
  stage.addEventListener('wheel', event => {
    if (event.target !== desktop || !focused || !event.deltaY) return;
    event.preventDefault();
    pointer(event, 'scroll', -Math.sign(event.deltaY) * 120);
  }, { passive: false });
  stage.addEventListener('focus', () => { focused = true; });
  stage.addEventListener('blur', () => { focused = false; release(); });
  window.addEventListener('blur', release);
  stage.addEventListener('keydown', event => {
    if (event.key === 'Escape') { stage.blur(); return; }
    if (event.key === 'Tab') return;
    const special = { ControlLeft: 0xA2, ControlRight: 0xA3, ShiftLeft: 0xA0, ShiftRight: 0xA1,
      AltLeft: 0xA4, AltRight: 0xA5, MetaLeft: 0x5B, MetaRight: 0x5C };
    const value = special[event.code] || event.keyCode;
    if (!value) return;
    event.preventDefault();
    held.set(event.code, value);
    enqueue({ kind: 'keyDown', code: value });
  });
  stage.addEventListener('keyup', event => {
    const value = held.get(event.code);
    if (!value) return;
    event.preventDefault();
    held.delete(event.code);
    enqueue({ kind: 'keyUp', code: value });
  });
  monitor.addEventListener('change', () => { frameMonitor = -1; release(); });
  get('fullscreen').addEventListener('click', async () => {
    try { await stage.requestFullscreen(); stage.focus(); }
    catch { status.textContent = 'This browser declined fullscreen.'; }
  });
  const stop = () => end('Session stopped. Enter a fresh code to reconnect.');
  get('stop').addEventListener('click', stop);
  cancel.addEventListener('click', stop);
  window.addEventListener('pagehide', () => socket?.close());
  if (!token) end('Open Control Another Computer from CineWall to start a new session.');
})();
