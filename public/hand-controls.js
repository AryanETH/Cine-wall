'use strict';
(() => {
  class CameraSession {
    constructor({ devices, makeWorker, bitmap, onResult, onError }) {
      Object.assign(this, { devices, makeWorker, bitmap, onResult, onError });
      this.generation = 0;
    }
    stop() {
      this.generation++;
      clearInterval(this.timer); clearTimeout(this.deadline); clearTimeout(this.frameDeadline);
      this.cancelInit?.(); this.cancelInit = null;
      this.worker?.terminate(); this.worker = null;
      this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
      if (this.video) { this.video.pause(); this.video.srcObject = null; }
      this.busy = false;
      return this.starting?.catch(() => {});
    }
    start(deviceId, video) {
      const draining = this.stop();
      const generation = this.generation;
      const starting = (async () => {
        if (draining) await draining;
        if (generation !== this.generation) return false;
        return this.open(deviceId, video, generation);
      })();
      this.starting = starting;
      const settled = () => { if (this.starting === starting) this.starting = null; };
      starting.then(settled, settled);
      return starting;
    }
    async open(deviceId, video, generation) {
      const stream = await this.devices.getUserMedia({ audio: false, video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }),
        width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 20 }
      } });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return false; }
      this.stream = stream; this.video = video;
      try {
        video.srcObject = stream;
        await video.play();
        if (generation !== this.generation) return false;
        const worker = this.makeWorker(); this.worker = worker;
        await new Promise((resolve, reject) => {
          let ready = false;
          const fail = error => {
            if (generation !== this.generation) return;
            if (!ready) reject(error);
            else { this.stop(); this.onError(error); }
          };
          this.cancelInit = () => reject(Object.assign(Error('Camera stopped'), { name: 'AbortError' }));
          this.deadline = setTimeout(() => fail(Error('The gesture model took too long to load. Try again.')), 30000);
          worker.onerror = () => fail(Error('Gesture recognition could not start. Try again in Chrome or Edge.'));
          worker.onmessage = ({ data }) => {
            if (generation !== this.generation) return;
            if (data.type === 'ready') {
              ready = true; clearTimeout(this.deadline); this.cancelInit = null; resolve();
            } else if (data.type === 'error') fail(Error('Gesture recognition stopped. Turn it on to retry.'));
            else if (data.type === 'result') {
              clearTimeout(this.frameDeadline); this.busy = false;
              this.onResult(data.result, data.timestamp);
            }
          };
          worker.postMessage({ type: 'init' });
        });
        if (generation !== this.generation) return false;
        for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => {
          if (generation === this.generation) { this.stop(); this.onError(Error('Camera disconnected. Select a camera and try again.')); }
        });
        let lastTime = -1;
        this.timer = setInterval(async () => {
          if (this.busy || video.readyState < 2 || video.currentTime === lastTime) return;
          this.busy = true; lastTime = video.currentTime;
          try {
            const frame = await this.bitmap(video);
            if (generation !== this.generation) { frame.close(); return; }
            worker.postMessage({ type: 'frame', frame, timestamp: performance.now() }, [frame]);
            this.frameDeadline = setTimeout(() => {
              if (generation === this.generation) { this.stop(); this.onError(Error('Camera tracking stopped responding. Turn it on to retry.')); }
            }, 5000);
          } catch (error) {
            if (generation === this.generation) { this.stop(); this.onError(Error('Camera frames could not be read. Turn it on to retry.')); }
          }
        }, 100);
        return true;
      } catch (error) {
        if (generation === this.generation) this.stop();
        throw error;
      }
    }
  }

  function create({ available, onAction, onPracticeStart = () => {} }) {
    const core = window.CineWallHandGestures;
    const $ = id => document.getElementById(id);
    const panel = $('handControlPanel'), toggle = $('handControlToggle'), video = $('handCamera');
    const dialog = $('handPractice'), gate = new core.HoldGate();
    const key = 'cinewall-hand-practice-v1';
    let enabled = false, trackingReady = false, request = 0, practice = null, advancing = false, nextTimer, previousFocus;
    let knownAvailable = false, resultCount = 0, startDeadline, tabs = null;
    const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
    const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
    function status(text) {
      $('handControlHint').textContent = text;
      $('handControlHint').hidden = text === 'Off' || text === 'Practice cancelled · camera off';
      $('handPlayerStatus').textContent = text;
    }
    function closePractice(restoreFocus = true) {
      clearTimeout(nextTimer); advancing = false; practice = null; gate.reset();
      if (dialog.open) dialog.close();
      $('handCameraMount').appendChild($('handCameraFeed'));
      if (restoreFocus && previousFocus?.isConnected) previousFocus.focus();
    }
    function park(text = 'Gestures on · ready in the active tab', keepEnabled = true) {
      request++; enabled = keepEnabled; trackingReady = false; toggle.checked = keepEnabled;
      clearTimeout(startDeadline);
      closePractice(false); const draining = session.stop(); gate.reset();
      $('handCameraOptions').hidden = true; $('handCameraFeed').hidden = true;
      $('handPlayerStatus').hidden = true;
      if ($('handPlayerOptions')) { $('handPlayerOptions').hidden = !keepEnabled; $('handPlayerOptions').open = false; }
      status(text);
      return draining;
    }
    function stop(text = 'Off') {
      tabs?.setEnabled(false);
      park(text, false);
    }
    function showStep() {
      const step = practice.step;
      $('handPracticeProgress').textContent = `${practice.index + 1} / ${core.steps.length}`;
      $('handPracticeIcon').textContent = step.icon;
      $('handPracticeTitle').textContent = `${step.title} · ${step.pose}`;
      $('handPracticeCopy').textContent = step.instruction;
      $('handPracticeHint').textContent = 'Hold it steady until the bar fills.';
      $('handPracticeHold').value = 0;
    }
    function startPractice() {
      if (!enabled || !trackingReady || !available() || (tabs && !tabs.active)) return;
      onPracticeStart();
      practice = new core.Practice(); advancing = false; clearTimeout(nextTimer); gate.reset();
      previousFocus = document.activeElement;
      $('handPracticeCamera').appendChild($('handCameraFeed'));
      showStep(); dialog.showModal(); $('handPracticeClose').focus();
      status('Practice mode · playback controls paused');
    }
    function result(data, time) {
      if (!enabled || !trackingReady || !available() || document.hidden) return;
      resultCount++;
      const label = core.labelFromResult(data), step = core.steps.find(item => item.label === label);
      $('handDetected').textContent = step ? `${step.icon} ${step.pose}` : data?.landmarks?.length > 1 ? 'Show one hand' : 'Show your hand';
      const held = gate.push(label, time);
      if (practice) {
        if (advancing) return;
        const matches = step?.id === practice.step.id;
        $('handPracticeHold').value = matches ? held.progress : 0;
        $('handPracticeHint').textContent = held.release && !held.action ? 'Lower your hand, then try the next gesture.' : matches ? 'Hold steady…' : 'Show the gesture above.';
        if (held.action && practice.match(held.action)) {
          advancing = true;
          $('handPracticeHold').value = 1;
          $('handPracticeHint').textContent = 'Matched ✓ · lower your hand';
          nextTimer = setTimeout(() => {
            if (!enabled || !practice) return;
            if (practice.done) {
              write(key, 'complete'); closePractice();
              // Do not let the final practice pose issue a seek command.
              gate.armed = false;
              status('Gestures on · lower your hand to begin');
            } else { advancing = false; showStep(); }
          }, 900);
        }
        return;
      }
      if (held.action) {
        const action = core.steps.find(item => item.id === held.action);
        const outcome = onAction(held.action);
        status(outcome === true ? `${action.title} · lower hand to repeat` : outcome || 'Load a video first');
      }
    }
    const session = new CameraSession({
      devices: navigator.mediaDevices,
      makeWorker: () => new Worker('/hand-gesture-worker.js?v=20261029-poses-2'),
      bitmap: source => createImageBitmap(source), onResult: result,
      onError: error => stop(error.message)
    });
    async function cameras() {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
      const active = session.stream?.getVideoTracks()[0]?.getSettings().deviceId;
      if (active) tabs?.setCamera(active);
      for (const id of ['handCameraSelect', 'handPracticeCameraSelect']) {
        $(id).replaceChildren(...devices.map((device, index) => {
          const option = document.createElement('option'); option.value = device.deviceId;
          option.textContent = device.label || `Camera ${index + 1}`;
          option.selected = device.deviceId === active;
          return option;
        }));
      }
    }
    async function start(deviceId = '') {
      if (tabs && !tabs.active) return;
      const ticket = ++request;
      if (!available()) { stop(); return; }
      enabled = true; trackingReady = false; toggle.checked = true; gate.reset();
      clearTimeout(startDeadline);
      startDeadline = setTimeout(() => { if (ticket === request) stop('Allow camera access in the browser, then turn gestures on again.'); }, 60000);
      status('Starting camera…');
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Error('Camera controls need HTTPS or localhost.');
        if (!window.Worker || !window.createImageBitmap) throw Error('Try camera controls in Chrome or Edge.');
        $('handCameraFeed').hidden = false;
        const started = await session.start(deviceId, video);
        if (!started || ticket !== request || !available()) return;
        await cameras();
        if (ticket !== request) return;
        clearTimeout(startDeadline);
        $('handCameraOptions').hidden = false; $('handPlayerStatus').hidden = false;
        if ($('handPlayerOptions')) $('handPlayerOptions').hidden = false;
        status('Gestures on · hold a gesture briefly');
        trackingReady = true;
        if (read(key) !== 'complete') startPractice();
      } catch (error) {
        if (ticket !== request) return;
        const message = { NotAllowedError: 'Camera permission denied. Allow camera access, then try again.',
          NotFoundError: 'No camera found. Connect a webcam and try again.',
          NotReadableError: 'Camera is busy. Close other camera apps and try again.',
          OverconstrainedError: 'That camera is unavailable. Turn on again to use the default camera.' }[error.name];
        stop(message || error.message || 'Camera could not start. Try again.');
      }
    }
    if (window.CineWallHandTabs && window.CineWallSession?.room && window.CineWallSession?.deviceId) {
      tabs = window.CineWallHandTabs.create({
        room: window.CineWallSession.room, device: window.CineWallSession.deviceId,
        id: window.CineWallSession.peerId,
        storage: localStorage, locks: navigator.locks,
        visible: () => !document.hidden, available,
        listen: callback => { window.addEventListener('storage', callback); return () => window.removeEventListener('storage', callback); },
        onChange: state => {
          if (state.enabled && state.active) return start(state.camera);
          return park(state.enabled ? 'Gestures on · ready in the active tab' : 'Off', state.enabled);
        },
        onError: text => park(text, false)
      });
    }
    toggle.addEventListener('change', () => toggle.checked ? (tabs ? tabs.setEnabled(true) : start()) : stop());
    function changeCamera(id) {
      if (!enabled || (tabs && !tabs.setCamera(id))) return;
      closePractice(); return start(id);
    }
    $('handCameraSelect').addEventListener('change', () => changeCamera($('handCameraSelect').value));
    $('handPracticeCameraSelect').addEventListener('change', () => changeCamera($('handPracticeCameraSelect').value));
    $('handPracticeAgain').addEventListener('click', startPractice);
    $('handPracticeStop').addEventListener('click', () => stop('Practice cancelled · camera off'));
    $('handPracticeClose').addEventListener('click', () => stop('Practice cancelled · camera off'));
    dialog.addEventListener('cancel', event => { event.preventDefault(); stop('Practice cancelled · camera off'); });
    document.addEventListener('visibilitychange', () => {
      if (tabs) {
        if (!document.hidden && document.hasFocus()) tabs.claim();
        else tabs.sync();
      }
      else if (document.hidden && enabled) stop('Camera off · turn on to resume');
    });
    window.addEventListener('focus', () => tabs?.claim());
    window.addEventListener('pagehide', () => {
      if (tabs) { tabs.dispose(); park('Off', false); }
      else stop();
    });
    function sync() {
      const allowed = available();
      const becameAvailable = allowed && !knownAvailable;
      panel.hidden = !allowed;
      if (!allowed && (enabled || knownAvailable)) {
        if (tabs) park(enabled ? 'Gestures on · ready in the active tab' : 'Off', enabled);
        else stop();
      }
      knownAvailable = allowed;
      if (becameAvailable && !document.hidden && document.hasFocus()) tabs?.claim();
      else tabs?.sync();
    }
    sync();
    if (!document.hidden && document.hasFocus()) tabs?.claim();
    return { sync, stop, get enabled() { return enabled; }, get resultCount() { return resultCount; } };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { CameraSession };
  if (typeof window !== 'undefined') window.CineWallHandControls = { create };
})();
