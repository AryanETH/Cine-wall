'use strict';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
function ask(client, payload) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Admin file source is unavailable')); }, 25000);
    channel.port1.onmessage = (event) => { clearTimeout(timer); channel.port1.close(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data); };
    client.postMessage(payload, [channel.port2]);
  });
}
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith('/__cinewall_peer__/')) return;
  event.respondWith((async () => {
    try {
      const client = await self.clients.get(event.clientId);
      if (!client) throw new Error('Display tab is unavailable');
      const version = url.pathname.split('/').pop();
      const info = await ask(client, { type: 'media-meta', version });
      if (!Number.isSafeInteger(info.size) || info.size <= 0 || typeof info.type !== 'string' || (info.type && !/^(video|audio)\/[a-z0-9.+-]+$/i.test(info.type))) throw new Error('Invalid source metadata');
      const range = event.request.headers.get('range');
      let start = 0, end = info.size - 1;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
        start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(end, Number(match[2])) : end;
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size || (range && /-0$/.test(range) && range.startsWith('bytes=-'))) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
      const headers = { 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
      // The final native retry omits only the MIME hint so the browser can sniff
      // the unchanged container. It does not turn MKV into MP4 or add a decoder.
      if (info.type) { headers['Content-Type'] = info.type; headers['X-Content-Type-Options'] = 'nosniff'; }
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
      if (event.request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
      let position = start, cancelled = false;
      const stream = new ReadableStream({ cancel() { cancelled = true; }, async pull(controller) {
        if (cancelled) return;
        try {
          const last = Math.min(end + 1, position + 256 * 1024);
          const data = await ask(client, { type: 'media-range', version, start: position, end: last });
          if (cancelled) return;
          if (data.buffer.byteLength !== last - position) throw new Error('Incomplete movie range');
          controller.enqueue(new Uint8Array(data.buffer)); position = last;
          if (position > end) controller.close();
        } catch (error) { if (!cancelled) controller.error(error); }
      } }, { highWaterMark: 1 });
      return new Response(stream, { status: range ? 206 : 200, headers });
    } catch (error) { return new Response(error.message, { status: 503 }); }
  })());
});
