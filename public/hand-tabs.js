'use strict';
(() => {
  // Same-origin, same-room, same-device intent; Web Locks serializes camera ownership.
  function create({ room, device, storage, locks, visible, available, onChange, onError = () => {},
    id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    listen, now = Date.now, every = setInterval, cancelEvery = clearInterval }) {
    const key = `cinewall-hand-tabs-v1:${room}:${device}`;
    let enabled = false, active = false, camera = '', pending = null, release = null, disposed = false;
    const read = () => { try { const value = JSON.parse(storage.getItem(key) || 'null'); return value?.expires > now() ? value : null; } catch { return null; } };
    function write(value) {
      try { value ? storage.setItem(key, JSON.stringify(value)) : storage.removeItem(key); return true; }
      catch { enabled = false; park(); onError('Allow site storage to share gesture controls between tabs.'); return false; }
    }
    function emit() { return onChange({ enabled, active, camera }); }
    function park() {
      pending?.abort(); pending = null;
      let stopping;
      if (active) { active = false; stopping = emit(); }
      // Keep the lock until late permission/startup work has released its camera too.
      const finish = release; release = null; finish?.(stopping);
    }
    function sync() {
      if (disposed) return;
      const value = read(), next = Boolean(value);
      camera = value?.camera || '';
      if (enabled !== next) { enabled = next; if (!enabled) park(); emit(); }
      if (!enabled || !visible() || !available()) {
        park();
        if (value?.owner === id) write({ ...value, owner: '' });
        return;
      }
      if (!value.owner) { write({ ...value, owner: id }); }
      else if (value.owner !== id) { park(); return; }
      if (active || pending) return;
      if (!locks?.request) { onError('Use Chrome or Edge for camera handoff between tabs.'); return; }
      const controller = new AbortController(); pending = controller;
      locks.request(key, { mode: 'exclusive', signal: controller.signal }, async () => {
        if (disposed || controller.signal.aborted || read()?.owner !== id || !visible() || !available()) return;
        const done = new Promise(resolve => { release = resolve; });
        active = true;
        const starting = Promise.resolve(emit()).catch(() => onError('Camera handoff failed. Turn gestures off and on again.'));
        await done;
        await starting;
      }).catch(error => { if (error.name !== 'AbortError') onError('Camera handoff failed. Turn gestures off and on again.'); })
        .finally(() => { if (pending === controller) pending = null; });
    }
    function setEnabled(value) {
      if (value && !locks?.request) { onError('Use Chrome or Edge for camera handoff between tabs.'); return; }
      if (!write(value ? { expires: now() + 120000, camera, owner: id } : null)) return;
      sync();
    }
    function claim() {
      const value = read();
      if (disposed || !value || !visible() || !available()) return;
      if (value.owner !== id) write({ ...value, owner: id });
      sync();
    }
    function setCamera(deviceId) {
      const value = read();
      if (!active || value?.owner !== id) return false;
      camera = deviceId || '';
      return write({ ...value, camera });
    }
    const unlisten = listen(event => { if (event.key === key || event.key === null) sync(); });
    const timer = every(() => {
      const value = read();
      // Once all camera tabs close, the intent expires rather than auto-starting next visit.
      if (active && value?.owner === id) write({ ...value, expires: now() + 120000 });
      sync();
    }, 30000);
    sync();
    return { sync, claim, setEnabled, setCamera, get enabled() { return enabled; }, get camera() { return camera; },
      get active() { return active && read()?.owner === id; },
      dispose() {
        disposed = true; park(); cancelEvery(timer); unlisten?.();
        const value = read(); if (value?.owner === id) write({ ...value, owner: '' });
      } };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { create };
  if (typeof window !== 'undefined') window.CineWallHandTabs = { create };
})();
