'use strict';

// Decorative demo data, never presented as measured visits.
function getDemoVisitCount(now = new Date()) {
  return 5000 + Math.max(0, Math.floor((now.getTime() - Date.UTC(2026, 9, 8)) / 45000));
}

function getDemoVisitSnapshot(serverNow = Date.now()) {
  const count = getDemoVisitCount(new Date(serverNow));
  return { count, serverNow, nextUpdateAt: Date.UTC(2026, 9, 8) + (count - 5000 + 1) * 45000, demo: true };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getDemoVisitCount, getDemoVisitSnapshot };
}

if (typeof document !== 'undefined') {
  const counter = document.querySelector('#demoVisitCount');
  if (counter) {
    const indicator = document.querySelector('#demoVisitLive');
    const status = document.querySelector('#demoVisitStatus');
    let timer;
    let pending = false;
    const updateCount = async () => {
      if (pending) return;
      clearTimeout(timer);
      pending = true;
      let delay = 10000;
      const started = performance.now();
      try {
        const response = await fetch('/api/demo-visits', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('Counter unavailable');
        const snapshot = await response.json();
        if (!snapshot.demo || !Number.isSafeInteger(snapshot.count) || snapshot.count < 5000 ||
            !Number.isFinite(snapshot.serverNow) || !Number.isFinite(snapshot.nextUpdateAt)) throw new Error('Invalid counter');
        counter.textContent = snapshot.count.toLocaleString('en-US');
        indicator?.classList.add('is-live');
        if (status) status.textContent = 'Live';
        // Schedule against server time, not each visitor's computer clock.
        delay = Math.max(100, Math.min(45000, snapshot.nextUpdateAt - snapshot.serverNow - (performance.now() - started) / 2 + 25));
      } catch {
        indicator?.classList.remove('is-live');
        if (status) status.textContent = 'Reconnecting';
      } finally {
        pending = false;
        timer = setTimeout(updateCount, delay);
      }
    };
    updateCount();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) updateCount(); });
    window.addEventListener('online', updateCount);
  }
}
