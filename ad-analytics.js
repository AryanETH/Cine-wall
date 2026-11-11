'use strict';

const fs = require('node:fs');
const path = require('node:path');
const atomicJson = require('./atomic-json');

const METRICS = ['served', 'impressions', 'clicks', 'q25', 'q50', 'q75', 'completed', 'skipped', 'failed'];
const DAY_MS = 24 * 60 * 60 * 1000;
const dayKey = time => new Date(time).toISOString().slice(0, 10);
const counts = () => Object.fromEntries(METRICS.map(metric => [metric, 0]));

function createAdAnalytics(directory, now = Date.now) {
  const file = path.join(directory, 'analytics.json');
  let days = {};
  let failureLogged = false;
  let readFailed = false;
  try { days = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') {
      readFailed = true;
      console.warn('Could not read ad analytics:', error.code || 'READ_ERROR');
    }
  }

  function record(run, ...metrics) {
    if (readFailed) return false;
    const recorded = run.recorded ||= new Set();
    const additions = metrics.filter(metric => !recorded.has(metric));
    if (!additions.length) return true;
    const day = run.analyticsDay ||= dayKey(now());
    const oldest = dayKey(now() - 89 * DAY_MS);
    const next = Object.fromEntries(Object.entries(days).filter(([day]) => day >= oldest));
    if (day < oldest) return true;
    const entries = next[day] || {};
    const { id, title } = run.slot;
    const entry = { ...counts(), ...entries[id], title };
    for (const metric of additions) entry[metric]++;
    next[day] = { ...entries, [id]: entry };
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      atomicJson(file, next);
    } catch (error) {
      if (!failureLogged) console.warn('Could not save ad analytics:', error.code || 'WRITE_ERROR');
      failureLogged = true;
      return false;
    }
    failureLogged = false;
    days = next;
    for (const metric of additions) recorded.add(metric);
    return true;
  }

  function report(windowDays) {
    if (readFailed) throw Object.assign(new Error('Analytics data could not be loaded.'), { status: 503 });
    const firstDay = dayKey(now() - (windowDays - 1) * DAY_MS);
    const lastDay = dayKey(now());
    const totals = counts();
    const creatives = new Map();
    for (const [day, entries] of Object.entries(days).sort(([a], [b]) => a.localeCompare(b))) {
      if (day < firstDay || day > lastDay) continue;
      for (const [id, entry] of Object.entries(entries)) {
        if (!creatives.has(id)) creatives.set(id, { id, ...counts() });
        const creative = creatives.get(id);
        creative.title = entry.title;
        for (const metric of METRICS) {
          const amount = entry[metric] || 0;
          totals[metric] += amount;
          creative[metric] += amount;
        }
      }
    }
    return { days: windowDays, totals, creatives: [...creatives.values()].sort((a, b) => b.impressions - a.impressions || b.served - a.served) };
  }

  return { record, report };
}

module.exports = createAdAnalytics;
