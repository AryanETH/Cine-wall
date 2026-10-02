'use strict';

(() => {
  const help = 'This video is not supported by your browser. Try an MP4 with H.264 video and AAC audio.';
  const unsupported = () => new Error(help);
  const word = (bytes, offset, length = 4) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  const MAX_METADATA = 8 * 1024 * 1024;

  function boxes(bytes, start = 0, end = bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const items = [];
    for (let offset = start; offset < end;) {
      if (offset + 8 > end || items.length > 10000) throw unsupported();
      let size = view.getUint32(offset), header = 8;
      if (size === 1) {
        if (offset + 16 > end) throw unsupported();
        size = view.getUint32(offset + 8) * 2 ** 32 + view.getUint32(offset + 12);
        header = 16;
      } else if (!size) size = end - offset;
      if (!Number.isSafeInteger(size) || size < header || offset + size > end) throw unsupported();
      items.push({ type: word(bytes, offset + 4), start: offset, payload: offset + header, end: offset + size });
      offset += size;
    }
    return items;
  }

  function aacDescription(bytes, sample) {
    // mp4a can also wrap MP3: require an AAC decoder descriptor (object type 0x40).
    if (sample.payload + 28 > sample.end) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(sample.payload + 8) !== 0) return false;
    const esds = boxes(bytes, sample.payload + 28, sample.end).find((box) => box.type === 'esds');
    if (!esds) return false;
    function descriptor(offset) {
      if (offset >= esds.end) throw unsupported();
      const tag = bytes[offset++];
      let size = 0, last;
      for (let i = 0; i < 4; i++) {
        if (offset >= esds.end) throw unsupported();
        last = bytes[offset++]; size = size * 128 + (last & 127);
        if (!(last & 128)) break;
      }
      if (last & 128 || offset + size > esds.end) throw unsupported();
      return { tag, offset, end: offset + size };
    }
    let entry = descriptor(esds.payload + 4);
    if (entry.tag === 3) {
      let offset = entry.offset + 3;
      const flags = bytes[entry.offset + 2];
      if (flags & 128) offset += 2;
      if (flags & 64) offset += 1 + bytes[offset];
      if (flags & 32) offset += 2;
      entry = descriptor(offset);
    }
    return entry.tag === 4 && entry.offset < entry.end && bytes[entry.offset] === 0x40;
  }

  function checkMp4Metadata(bytes) {
    const child = (parent, type) => boxes(bytes, parent.payload, parent.end).find((box) => box.type === type);
    let videoFound = false;
    for (const track of boxes(bytes).filter((box) => box.type === 'trak')) {
      const mdia = child(track, 'mdia');
      if (!mdia) continue;
      const handler = child(mdia, 'hdlr');
      const kind = handler && word(bytes, handler.payload + 8);
      if (!['vide', 'soun'].includes(kind)) continue;
      const minf = child(mdia, 'minf'), stbl = minf && child(minf, 'stbl'), stsd = stbl && child(stbl, 'stsd');
      if (!stsd || stsd.payload + 8 > stsd.end) throw unsupported();
      const descriptions = boxes(bytes, stsd.payload + 8, stsd.end);
      if (!descriptions.length) throw unsupported();
      for (const sample of descriptions) {
        if (kind === 'vide') {
          const configType = { avc1: 'avcC', avc3: 'avcC', vp09: 'vpcC', av01: 'av1C' }[sample.type];
          if (!configType) throw unsupported();
          const config = boxes(bytes, sample.payload + 78, sample.end).find((box) => box.type === configType);
          if (!config) throw unsupported();
          if (configType === 'avcC' && ![66, 77, 88, 100].includes(bytes[config.payload + 1])) throw unsupported();
          if (configType === 'vpcC' && (config.payload + 8 > config.end || bytes[config.payload + 4] !== 0 || bytes[config.payload + 6] >> 4 !== 8)) throw unsupported();
          if (configType === 'av1C' && (config.payload + 4 > config.end || bytes[config.payload + 1] >> 5 !== 0 || (bytes[config.payload + 2] & 0x40))) throw unsupported();
          videoFound = true;
        } else if (sample.type !== 'mp4a' || !aacDescription(bytes, sample)) throw unsupported();
      }
    }
    if (!videoFound) throw unsupported();
  }

  function ebmlHeader(bytes, offset = 0) {
    const vint = (start, id) => {
      if (!bytes[start]) throw unsupported();
      let length = 1, marker = 128;
      while (!(bytes[start] & marker)) { length++; marker >>= 1; }
      if (length > (id ? 4 : 8) || start + length > bytes.length) throw unsupported();
      let value = id ? bytes[start] : bytes[start] & (marker - 1);
      let unknown = !id && value === marker - 1;
      for (let i = 1; i < length; i++) { value = value * 256 + bytes[start + i]; unknown = unknown && bytes[start + i] === 255; }
      if (!unknown && !Number.isSafeInteger(value)) throw unsupported();
      return { length, value: unknown ? Infinity : value };
    };
    const id = vint(offset, true), size = vint(offset + id.length, false);
    return { id: id.value, payload: offset + id.length + size.length, size: size.value };
  }

  function ebmlChildren(bytes) {
    const children = [];
    for (let offset = 0; offset < bytes.length;) {
      const item = ebmlHeader(bytes, offset), end = item.payload + item.size;
      if (!Number.isSafeInteger(end) || end > bytes.length || children.length >= 10000) throw unsupported();
      children.push({ id: item.id, bytes: bytes.subarray(item.payload, end) });
      offset = end;
    }
    return children;
  }

  async function inspectMkv(file) {
    // Read EBML/track metadata only. Skip clusters, tags and attachments by size,
    // rather than buffering gigabytes or trusting a filename/codec-name string.
    const readHeader = async (offset, limit = file.size) => {
      const bytes = new Uint8Array(await file.slice(offset, Math.min(limit, offset + 12)).arrayBuffer());
      const item = ebmlHeader(bytes);
      const payload = offset + item.payload, end = item.size === Infinity ? limit : payload + item.size;
      if (!Number.isSafeInteger(end) || end > limit || payload > end) throw unsupported();
      return { ...item, payload, end };
    };
    const ebml = await readHeader(0);
    if (ebml.id !== 0x1a45dfa3 || ebml.size > 4096) throw unsupported();
    const header = new Uint8Array(await file.slice(ebml.payload, ebml.end).arrayBuffer());
    const docType = ebmlChildren(header).find((item) => item.id === 0x4282)?.bytes;
    if (!docType || word(docType, 0, docType.length) !== 'matroska') throw unsupported();
    let segment;
    for (let offset = ebml.end, count = 0; offset < file.size && count < 1000; count++) {
      const item = await readHeader(offset);
      if (item.id === 0x18538067) { segment = item; break; }
      if (item.end <= offset) throw unsupported();
      offset = item.end;
    }
    if (!segment) throw unsupported();
    for (let offset = segment.payload, count = 0; offset < segment.end && count < 1000; count++) {
      const item = await readHeader(offset, segment.end);
      if (item.id === 0x1654ae6b) {
        if (item.size > MAX_METADATA) throw unsupported();
        const bytes = new Uint8Array(await file.slice(item.payload, item.end).arrayBuffer());
        let videoFound = false;
        const codecs = new Set();
        const tracks = ebmlChildren(bytes).filter((child) => child.id === 0xae);
        if (!tracks.length) throw unsupported();
        for (const track of tracks) {
          const fields = ebmlChildren(track.bytes);
          const kind = fields.find((field) => field.id === 0x83)?.bytes;
          if (!kind || kind.length !== 1) throw unsupported();
          if (![1, 2].includes(kind[0])) continue; // Subtitles are not decoder requirements.
          const codec = fields.find((field) => field.id === 0x86)?.bytes;
          const privateData = fields.find((field) => field.id === 0x63a2)?.bytes;
          if (!codec || codec.length > 64 || !privateData) throw unsupported();
          const name = word(codec, 0, codec.length);
          codecs.add(name);
          if (kind[0] === 1) {
            if (name !== 'V_MPEG4/ISO/AVC' || privateData.length < 7 || privateData[0] !== 1 || ![66, 77, 88, 100].includes(privateData[1])) throw unsupported();
            videoFound = true;
          } else {
            // AAC Main/LC/HE (including the dual HE-AAC tracks in the user's MKV).
            if (!/^A_AAC(?:\/MPEG[24]\/(?:MAIN|LC|LC\/SBR|SSR))?$/.test(name) || privateData.length < 2 || ![1, 2, 5, 29].includes(privateData[0] >> 3)) throw unsupported();
          }
        }
        if (!videoFound) throw unsupported();
        return { type: 'video/x-matroska', codecs: [...codecs] };
      }
      if (item.size === Infinity || item.end <= offset) throw unsupported();
      offset = item.end;
    }
    throw unsupported();
  }

  async function inspect(file, matroskaCodecs) {
    const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
    if (!['.mp4', '.m4v', '.webm', '.mkv'].includes(extension) || !file.size) throw unsupported();
    if (extension === '.mkv') return (await inspectMkv(file)).type;
    if (extension === '.webm') {
      const header = new Uint8Array(await file.slice(0, Math.min(file.size, 256 * 1024)).arrayBuffer());
      if (![0x1a, 0x45, 0xdf, 0xa3].every((value, index) => header[index] === value)) throw unsupported();
      const docType = header.findIndex((value, index) => value === 0x42 && header[index + 1] === 0x82 && header[index + 2] === 0x84 && word(header, index + 3) === 'webm');
      const codecs = matroskaCodecs?.(header) || [];
      if (docType < 0 || !codecs.some((codec) => ['V_VP8', 'V_VP9'].includes(codec)) || codecs.some((codec) => !['V_VP8', 'V_VP9', 'A_OPUS', 'A_VORBIS'].includes(codec))) throw unsupported();
      return 'video/webm';
    }
    // Read box headers and only the movie metadata, skipping the movie's large data box.
    for (let offset = 0, count = 0; offset + 8 <= file.size && count < 1000; count++) {
      const header = new Uint8Array(await file.slice(offset, Math.min(file.size, offset + 16)).arrayBuffer());
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      let size = view.getUint32(0), headerSize = 8;
      if (size === 1) { if (header.length < 16) throw unsupported(); size = view.getUint32(8) * 2 ** 32 + view.getUint32(12); headerSize = 16; }
      else if (!size) size = file.size - offset;
      if (!Number.isSafeInteger(size) || size < headerSize || offset + size > file.size) throw unsupported();
      const type = word(header, 4);
      if (!offset && type !== 'ftyp') throw unsupported();
      if (type === 'moov') {
        if (size > MAX_METADATA) throw unsupported();
        checkMp4Metadata(new Uint8Array(await file.slice(offset + headerSize, offset + size).arrayBuffer()));
        return 'video/mp4';
      }
      offset += size;
    }
    throw unsupported();
  }

  async function probeFile(file, type, video = true) {
    const failure = () => new Error(video ? help : 'This audio format is not supported by your browser. Try MP3, WAV or AAC audio.');
    const probe = document.createElement(video ? 'video' : 'audio');
    // Some browser versions under-report Matroska in canPlayType. Let the
    // actual frame decode decide, without relabeling or converting the file.
    if (!probe.canPlayType(type) && type !== 'video/x-matroska') throw failure();
    const url = URL.createObjectURL(file.slice(0, file.size, type));
    probe.muted = true; probe.playsInline = true; probe.preload = 'auto';
    // Keep the decoder connected to the page so frame callbacks can run.
    probe.setAttribute('aria-hidden', 'true');
    Object.assign(probe.style, { position: 'fixed', width: '1px', height: '1px', bottom: '0', left: '0', opacity: '0.01', pointerEvents: 'none' });
    document.body.appendChild(probe);
    let frame;
    try {
      await new Promise((resolve, reject) => {
        let done = false;
        const finish = (error) => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(); };
        const timer = setTimeout(() => finish(failure()), 12000);
        probe.addEventListener('error', () => finish(failure()), { once: true });
        probe.addEventListener('loadedmetadata', () => {
          if (video && (!probe.videoWidth || !probe.videoHeight)) { finish(failure()); return; }
          if (video && probe.requestVideoFrameCallback) frame = probe.requestVideoFrameCallback(() => finish());
          else if (probe.readyState >= 2) finish();
          else probe.addEventListener('loadeddata', () => finish(), { once: true });
          probe.play().catch(() => finish(failure()));
        }, { once: true });
        probe.src = url; probe.load();
      });
    } finally {
      if (frame !== undefined) probe.cancelVideoFrameCallback?.(frame);
      probe.pause(); probe.removeAttribute('src'); probe.load(); probe.remove(); URL.revokeObjectURL(url);
    }
  }

  async function validate(file) { await probeFile(file, await inspect(file, window.CineWallFilePeer?.matroskaCodecs)); }
  async function validateAudio(file) {
    const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
    const type = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.flac': 'audio/flac', '.webm': 'audio/webm' }[extension];
    if (!type || !file.size) throw new Error('This audio format is not supported by your browser. Try MP3, WAV or AAC audio.');
    await probeFile(file, type, false);
  }

  const api = { help, inspect, validate, validateAudio, inspectMkvCodecs: async (file) => (await inspectMkv(file)).codecs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.CineWallVideoFile = api;
})();
