'use strict';
(() => {
  // Same-origin, same-room, same-device intent; Web Locks serializes camera ownership.
  function create({ room, device, storage, locks, visible, available, onChange, onError = () => {},
    listen, now = Date.now, every = setInterval, cancelEvery = clearInterval }) {
    const key = `cinewall-hand-tabs-v1:${room}:${device}`;
    let enabled = false, active = false, camera = '', pending = null, release = null, disposed = false;
    const read = () => { try { const value = JSON.parse(storage.getItem(key) || 'null'); return value?.expires > now() ? value : null; } catch { return null; } };
    function write(value) {
      try { value ? storage.setItem(key, JSON.stringify(value)) : storage.removeItem(key); return true; }
      catch { enabled = false; park(); onError('Allow site storage to share gesture controls between tabs.'); return false; }
    }
    function emit() { onChange({ enabled, active, camera }); }
    function park() {
      pending?.abort(); pending = null;
      if (active) { active = false; emit(); }
      const finish = release; release = null; finish?.();
    }
    function sync() {
      if (disposed) return;
      const value = read(), next = Boolean(value);
      camera = value?.camera || '';
      if (enabled !== next) { enabled = next; if (!enabled) park(); emit(); }
      if (!enabled || !visible() || !available()) { park(); return; }
      if (active || pending) return;
      if (!locks?.request) { onError('Use Chrome or Edge for camera handoff between tabs.'); return; }
      const controller = new AbortController(); pending = controller;
      locks.request(key, { mode: 'exclusive', signal: controller.signal }, async () => {
        if (disposed || controller.signal.aborted || !read() || !visible() || !available()) return;
        const done = new Promise(resolve => { release = resolve; });
        active = true; emit();
        await done;
      }).catch(error => { if (error.name !== 'AbortError') onError('Camera handoff failed. Turn gestures off and on again.'); })
        .finally(() => { if (pending === controller) pending = null; });
    }
    function setEnabled(value) {
      if (value && !locks?.request) { onError('Use Chrome or Edge for camera handoff between tabs.'); return; }
      if (!write(value ? { expires: now() + 120000, camera } : null)) return;
      sync();
    }
    function setCamera(id) {
      camera = id || '';
      const value = read();
      if (value) write({ ...value, camera });
    }
    const unlisten = listen(event => { if (event.key === key || event.key === null) sync(); });
    const timer = every(() => {
      const value = read();
      // Once all camera tabs close, the intent expires rather than auto-starting next visit.
      if (active && value) write({ ...value, expires: now() + 120000 });
      sync();
    }, 30000);
    sync();
    return { sync, setEnabled, setCamera, get enabled() { return enabled; }, get camera() { return camera; },
      dispose() { disposed = true; park(); cancelEvery(timer); unlisten?.(); } };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { create };
  if (typeof window !== 'undefined') window.CineWallHandTabs = { create };
})();
