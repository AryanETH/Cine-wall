'use strict';
const fs = require('node:fs');
const fileResponse = require('./file-response');
module.exports = function serveAsset(req, res, file, type, versioned = false, { cacheControl, onMissing } = {}) {
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) {
      if (onMissing?.()) return;
      res.writeHead(404); res.end(); return;
    }
    const etag = `"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'ETag': etag, 'X-Content-Type-Options': 'nosniff',
      'Cache-Control': cacheControl || (versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=86400, stale-while-revalidate=604800') };
    if (req.headers['if-none-match'] === etag && !req.headers.range) { res.writeHead(304, headers); res.end(); return; }
    let start = 0, end = stat.size - 1, status = 200;
    if (req.headers.range && (!req.headers['if-range'] || req.headers['if-range'] === etag)) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (match && (match[1] || match[2])) {
        start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(end, Number(match[2])) : end;
      } else start = NaN;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= stat.size) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` }); res.end(); return;
      }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    if (req.method === 'HEAD') { res.writeHead(status, headers); res.end(); return; }
    fileResponse(req, res, file, { start, end, status, headers });
  });
};
