'use strict';
((root) => {
  function parse(text) {
    if (typeof text !== 'string' || text.length > 2 * 1024 * 1024) throw Error('Caption file must be 2 MB or smaller.');
    const stamp = value => {
      const parts = value.replace(',', '.').split(':').map(Number);
      if (parts.length < 2 || parts.length > 3 || parts.some(n => !Number.isFinite(n) || n < 0)) return NaN;
      return parts.reduce((sum, n) => sum * 60 + n, 0);
    };
    const cues = [];
    for (const block of text.replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n\s*\n/)) {
      const lines = block.split('\n');
      const timing = lines.findIndex(line => line.includes('-->'));
      if (timing < 0) continue;
      const match = /^\s*([\d:.,]+)\s+-->\s+([\d:.,]+)/.exec(lines[timing]);
      if (!match) continue;
      const start = stamp(match[1]), end = stamp(match[2]);
      const words = lines.slice(timing + 1).join('\n').replace(/<[^>]*>/g, '').trim();
      if (Number.isFinite(start) && Number.isFinite(end) && end > start && words) {
        cues.push({ start, end, text: words.slice(0, 2000) });
      }
      if (cues.length > 20000) throw Error('This caption file has too many entries.');
    }
    if (!cues.length) throw Error('No captions found. Choose an SRT or WebVTT file.');
    return cues.sort((a, b) => a.start - b.start);
  }
  const api = { parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CineWallCaptions = api;
})(typeof window !== 'undefined' ? window : globalThis);
