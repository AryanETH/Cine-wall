'use strict';
function sharedTabs() {
  const values = new Map(), tabs = new Map(), queues = new Map();
  let clock = 1000;
  const locks = { request(key, options, callback) {
    return new Promise((resolve, reject) => {
      const queue = queues.get(key) || []; queues.set(key, queue);
      const entry = { active: false, run() {
        if (entry.active) return;
        entry.active = true;
        Promise.resolve().then(callback).then(resolve, reject).finally(() => {
          queue.shift(); queue[0]?.run();
        });
      } };
      options.signal?.addEventListener('abort', () => {
        if (entry.active) return;
        const index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1);
        reject(Object.assign(Error('Aborted'), { name: 'AbortError' }));
      });
      queue.push(entry); if (queue.length === 1) entry.run();
    });
  } };
  function tab(id) {
    const listeners = new Set(), timers = new Set();
    const emit = key => { for (const [other, target] of tabs) if (other !== id) for (const listener of target.listeners) listener({ key }); };
    const storage = { getItem: key => values.get(key) || null,
      setItem(key, value) { values.set(key, value); emit(key); }, removeItem(key) { values.delete(key); emit(key); } };
    const target = { id, storage, locks, values, listeners, now: () => clock,
      every: fn => { timers.add(fn); return fn; }, cancelEvery: fn => timers.delete(fn),
      listen: fn => { listeners.add(fn); return () => listeners.delete(fn); },
      tick: () => { for (const fn of timers) fn(); } };
    tabs.set(id, target); return target;
  }
  return { values, tab, advance(ms) { clock += ms; }, async flush() { await new Promise(resolve => setImmediate(resolve)); } };
}
module.exports = { sharedTabs };
