'use strict';
(() => {
  const uuid = () => crypto.randomUUID?.() || '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
  // SHA-256 fallback keeps file identity identical on HTTPS and an HTTP LAN.
  function sha256(bytes) {
    const primes = [], k = [], initial = [];
    for (let n = 2; primes.length < 64; n++) if (!primes.some((p) => n % p === 0)) { primes.push(n); k.push(Math.floor((Math.cbrt(n) % 1) * 2 ** 32) | 0); if (initial.length < 8) initial.push(Math.floor((Math.sqrt(n) % 1) * 2 ** 32) | 0); }
    const data = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64); data.set(bytes); data[bytes.length] = 128;
    const view = new DataView(data.buffer); view.setUint32(data.length - 8, Math.floor(bytes.length * 8 / 2 ** 32)); view.setUint32(data.length - 4, bytes.length * 8);
    const rotate = (x, n) => (x >>> n) | (x << (32 - n)); const h = [...initial], w = new Int32Array(64);
    for (let offset = 0; offset < data.length; offset += 64) {
      for (let i = 0; i < 64; i++) w[i] = i < 16 ? view.getInt32(offset + i * 4) : (w[i - 16] + (rotate(w[i - 15], 7) ^ rotate(w[i - 15], 18) ^ w[i - 15] >>> 3) + w[i - 7] + (rotate(w[i - 2], 17) ^ rotate(w[i - 2], 19) ^ w[i - 2] >>> 10)) | 0;
      let [a, b, c, d, e, f, g, z] = h;
      for (let i = 0; i < 64; i++) { const t = (z + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + k[i] + w[i]) | 0; const u = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0; z = g; g = f; f = e; e = (d + t) | 0; d = c; c = b; b = a; a = (t + u) | 0; }
      [a, b, c, d, e, f, g, z].forEach((value, i) => { h[i] = (h[i] + value) | 0; });
    }
    return h.map((value) => (value >>> 0).toString(16).padStart(8, '0')).join('');
  }
  async function fingerprint(file) {
    const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
    const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 65536)).arrayBuffer());
    const size = new TextEncoder().encode(String(file.size));
    const bytes = new Uint8Array(head.length + tail.length + size.length); bytes.set(head); bytes.set(tail, head.length); bytes.set(size, head.length + tail.length);
    return sha256(bytes);
  }
  class FilePeer {
    constructor() {
      this.id = uuid(); this.file = null; this.asset = null; this.connections = new Map(); this.connectionTasks = new Map(); this.waiting = new Map(); this.sequence = 0; this.generation = 0;
      this.local = new BroadcastChannel(`cinewall-file-${window.CineWallSession?.room || 'lan'}`);
      this.local.onmessage = (event) => this.onLocal(event.data);
      this.events = new EventSource(`/events?peer=${this.id}`);
      this.events.addEventListener('state', (event) => {
        const asset = JSON.parse(event.data).asset;
        if (this.file && asset?.peerId === this.id && asset.fingerprint === this.publishingFingerprint) this.asset = asset;
      });
      this.events.addEventListener('peer-signal', (event) => this.onSignal(JSON.parse(event.data)).catch((error) => this.report(error)));
      if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', (event) => {
        if (!['media-meta', 'media-range'].includes(event.data?.type) || !event.ports[0]) return;
        const port = event.ports[0];
        Promise.resolve().then(async () => {
          if (event.data.version !== this.asset?.version) throw new Error('The selected movie changed');
          if (event.data.type === 'media-meta') return { size: this.asset.size, type: this.asset.type || 'video/mp4' };
          return { buffer: await this.range(event.data.start, event.data.end) };
        }).then((data) => port.postMessage(data, data.buffer ? [data.buffer] : [])).catch((error) => { if (event.data.version === this.asset?.version) this.report(error); port.postMessage({ error: error.message }); });
      });
    }
    report(error) { window.dispatchEvent(new CustomEvent('cinewall-peer-error', { detail: error.message })); }
    async request(route, body) { const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; }
    async publish(file, duration = 0) {
      this.clear(); this.file = file; this.fileUrl = URL.createObjectURL(file);
      const types = { mkv: 'video/x-matroska', mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac' };
      this.publishingFingerprint = await fingerprint(file);
      const result = await this.request('/api/local-source', { peerId: this.id, name: file.name, size: file.size, type: file.type || types[file.name.split('.').pop().toLowerCase()] || 'video/mp4', duration, fingerprint: this.publishingFingerprint });
      this.asset = result.state.asset; return result.state;
    }
    async selectSameFile(file, asset) {
      const generation = this.generation;
      if (file.size !== asset.size || await fingerprint(file) !== asset.fingerprint) throw new Error('Select the same movie file as the admin, not a different version.');
      if (generation !== this.generation || this.asset?.version !== asset.version) throw new Error('The selected movie changed. Choose the new file.');
      this.file = file; this.asset = asset; if (this.fileUrl) URL.revokeObjectURL(this.fileUrl); this.fileUrl = URL.createObjectURL(file); return this.fileUrl;
    }
    clear() {
      this.generation++;
      for (const peer of this.connections.values()) { peer.closed = true; peer.pc.close(); }
      this.connections.clear(); this.connectionTasks.clear();
      for (const item of this.waiting.values()) { clearTimeout(item.timer); item.reject(new Error('The local source changed')); }
      this.waiting.clear();
      if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
      this.fileUrl = ''; this.file = null; this.asset = null; this.publishingFingerprint = '';
    }
    async open(asset) {
      if (this.asset?.version !== asset.version) { this.clear(); this.asset = asset; }
      const generation = this.generation;
      if (this.file) return this.fileUrl;
      try { const local = await this.localRequest({ type: 'locate', version: asset.version }, 400); if (generation === this.generation && local.url) return local.url; } catch {}
      if (generation !== this.generation) throw new Error('The selected movie changed');
      if (!navigator.serviceWorker || !window.isSecureContext) throw new Error('For instant HTTP/LAN playback, select the same movie on this laptop. HTTPS enables direct peer sharing.');
      await navigator.serviceWorker.register('/media-worker.js'); await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise((resolve, reject) => {
        const changed = () => { if (navigator.serviceWorker.controller) { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', changed); resolve(); } };
        const timer = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', changed); reject(new Error('Reload this display to enable direct sharing')); }, 5000);
        navigator.serviceWorker.addEventListener('controllerchange', changed); changed();
      });
      if (generation !== this.generation) throw new Error('The selected movie changed');
      return window.CineWallSession?.link(`/__cinewall_peer__/${asset.version}`) || `/__cinewall_peer__/${asset.version}`;
    }
    localRequest(body, timeout = 400) {
      const id = ++this.sequence;
      return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.waiting.delete(`local-${id}`); reject(new Error('Local source not found')); }, timeout); this.waiting.set(`local-${id}`, { resolve, reject, timer }); this.local.postMessage({ ...body, id, from: this.id }); });
    }
    async onLocal(data) {
      if (data.to === this.id) { const item = this.waiting.get(`local-${data.id}`); if (item) { clearTimeout(item.timer); this.waiting.delete(`local-${data.id}`); item.resolve(data); } return; }
      if (!this.file || data.version !== this.asset?.version) return;
      if (data.type === 'locate') this.local.postMessage({ to: data.from, id: data.id, url: this.fileUrl });
    }
    async range(start, end) {
      const asset = this.asset;
      if (!asset || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > asset.size || end <= start || end - start > 256 * 1024) throw new Error('Invalid movie range');
      if (this.file) return this.file.slice(start, end).arrayBuffer();
      const generation = this.generation, peer = await this.connect(asset.peerId);
      if (generation !== this.generation) throw new Error('The selected movie changed');
      const id = ++this.sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.waiting.delete(`rtc-${id}`); reject(new Error('Direct file connection timed out. Configure TURN or select the same file on this laptop.')); }, 20000);
        this.waiting.set(`rtc-${id}`, { resolve, reject, timer, chunks: [], expected: end - start, received: 0 });
        try { peer.channel.send(JSON.stringify({ type: 'range', id, version: asset.version, start, end })); }
        catch (error) { clearTimeout(timer); this.waiting.delete(`rtc-${id}`); reject(error); }
      });
    }
    async makePeer(id, offer) {
      const generation = this.generation;
      if (this.connections.size + this.connectionTasks.size > 8) throw new Error('Too many file connections');
      const info = await fetch('/api/info').then((r) => r.json());
      if (generation !== this.generation) throw new Error('The selected movie changed');
      const pc = new RTCPeerConnection({ iceServers: info.iceServers || [] });
      const peer = { pc, channel: null, candidates: [], queue: Promise.resolve(), queued: 0, closed: false }; this.connections.set(id, peer);
      pc.onicecandidate = (event) => { if (event.candidate && !peer.closed) this.request('/api/peer-signal', { from: this.id, to: id, candidate: event.candidate }).catch((error) => { if (!peer.closed) this.report(error); }); };
      pc.onconnectionstatechange = () => { if (!peer.closed && ['failed', 'closed'].includes(pc.connectionState)) { this.connections.delete(id); this.report(new Error('Peer connection lost. Keep the admin tab open, configure TURN, or select the same local file.')); } };
      const bind = (channel) => { peer.channel = channel; channel.binaryType = 'arraybuffer'; channel.bufferedAmountLowThreshold = 128 * 1024; channel.onmessage = (event) => this.onData(peer, event.data); };
      pc.ondatachannel = (event) => bind(event.channel);
      if (offer) { bind(pc.createDataChannel('movie-ranges', { ordered: true })); await pc.setLocalDescription(await pc.createOffer()); await this.request('/api/peer-signal', { from: this.id, to: id, description: pc.localDescription }); }
      return peer;
    }
    async getPeer(id, offer) {
      if (this.connections.has(id)) return this.connections.get(id);
      if (!this.connectionTasks.has(id)) {
        const task = this.makePeer(id, offer).finally(() => { if (this.connectionTasks.get(id) === task) this.connectionTasks.delete(id); });
        this.connectionTasks.set(id, task);
      }
      return this.connectionTasks.get(id);
    }
    async connect(id) {
      const peer = await this.getPeer(id, true);
      const deadline = Date.now() + 15000;
      while (peer.channel?.readyState !== 'open') { if (Date.now() > deadline || ['failed', 'closed'].includes(peer.pc.connectionState)) throw new Error('Direct connection unavailable. Configure TURN or select the same file locally.'); await new Promise((resolve) => setTimeout(resolve, 50)); }
      return peer;
    }
    async onSignal(data) {
      if (!this.asset && !this.file) return;
      const peer = await this.getPeer(data.from, false);
      peer.signalQueue = (peer.signalQueue || Promise.resolve()).then(async () => {
      if (data.description) {
        await peer.pc.setRemoteDescription(data.description);
        for (const candidate of peer.candidates.splice(0)) await peer.pc.addIceCandidate(candidate);
        if (data.description.type === 'offer') { await peer.pc.setLocalDescription(await peer.pc.createAnswer()); await this.request('/api/peer-signal', { from: this.id, to: data.from, description: peer.pc.localDescription }); }
      } else if (data.candidate) { if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate); else if (peer.candidates.length < 128) peer.candidates.push(data.candidate); }
      });
      return peer.signalQueue;
    }
    onData(peer, data) {
      try {
      if (typeof data === 'string') {
        if (data.length > 2048) throw new Error('Invalid file request');
        const message = JSON.parse(data);
        if (!Number.isSafeInteger(message.id) || message.id < 1 || message.id > 0xffffffff) throw new Error('Invalid range identity');
        if (message.type === 'range') {
          if (peer.queued >= 8) throw new Error('Too many pending ranges');
          peer.queued++;
          peer.queue = peer.queue.then(() => this.sendRange(peer.channel, message)).catch((error) => { if (peer.channel.readyState === 'open') peer.channel.send(JSON.stringify({ type: 'error', id: message.id, error: error.message })); }).finally(() => { peer.queued--; });
        }
        if (message.type === 'end' || message.type === 'error') {
          const item = this.waiting.get(`rtc-${message.id}`); if (!item) return; clearTimeout(item.timer); this.waiting.delete(`rtc-${message.id}`);
          if (message.type === 'error' || item.received !== item.expected) item.reject(new Error(message.error || 'Incomplete peer data'));
          else { const output = new Uint8Array(item.expected); let offset = 0; for (const chunk of item.chunks) { output.set(chunk, offset); offset += chunk.length; } item.resolve(output.buffer); }
        }
      } else {
        if (!data || data.byteLength < 4 || data.byteLength > 16 * 1024 + 4) throw new Error('Invalid peer packet');
        const id = new DataView(data).getUint32(0); const item = this.waiting.get(`rtc-${id}`); if (!item) return;
        const chunk = new Uint8Array(data, 4); item.received += chunk.length; if (item.received <= item.expected) item.chunks.push(chunk); else { clearTimeout(item.timer); this.waiting.delete(`rtc-${id}`); item.reject(new Error('Peer range exceeded requested size')); }
      }
      } catch (error) { this.report(error); }
    }
    async sendRange(channel, request) {
      if (!this.file || request.version !== this.asset?.version || !Number.isSafeInteger(request.start) || !Number.isSafeInteger(request.end) || request.start < 0 || request.end > this.file.size || request.end <= request.start || request.end - request.start > 256 * 1024) throw new Error('The local source is unavailable or range is invalid');
      const bytes = new Uint8Array(await this.file.slice(request.start, request.end).arrayBuffer());
      for (let offset = 0; offset < bytes.length; offset += 16 * 1024) {
        if (channel.readyState !== 'open') throw new Error('Display disconnected');
        if (channel.bufferedAmount > 512 * 1024) await new Promise((resolve, reject) => {
          const cleanup = () => { clearTimeout(timer); channel.removeEventListener('bufferedamountlow', low); channel.removeEventListener('close', closed); };
          const low = () => { cleanup(); resolve(); };
          const closed = () => { cleanup(); reject(new Error('Display disconnected')); };
          const timer = setTimeout(() => { cleanup(); reject(new Error('Display connection is stalled')); }, 10000);
          channel.addEventListener('bufferedamountlow', low); channel.addEventListener('close', closed);
          if (channel.readyState !== 'open') closed(); else if (channel.bufferedAmount <= 128 * 1024) low();
        });
        const chunk = bytes.subarray(offset, offset + 16 * 1024), packet = new Uint8Array(chunk.length + 4); new DataView(packet.buffer).setUint32(0, request.id); packet.set(chunk, 4); channel.send(packet);
      }
      channel.send(JSON.stringify({ type: 'end', id: request.id }));
    }
  }
  window.CineWallFilePeer = { FilePeer, fingerprint, sha256 };
})();
