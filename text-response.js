'use strict';
const { promisify } = require('node:util');
const zlib = require('node:zlib');
const brotli = promisify(zlib.brotliCompress), gzip = promisify(zlib.gzip);
const entries = new Map();

module.exports = async function textResponse(req, key, data, type) {
  if (data.length < 1024 || !/^(?:text\/|application\/(?:javascript|json|manifest\+json))/.test(type)) return { body: data, headers: {} };
  const accepts = new Map(String(req.headers['accept-encoding'] || '').toLowerCase().split(',').map(part => {
    const [name, ...params] = part.trim().split(';');
    const quality = params.find(param => param.trim().startsWith('q='));
    return [name, quality ? Number(quality.trim().slice(2)) : 1];
  }));
  const options = ['br', 'gzip'].map(name => ({ name, quality: accepts.get(name) ?? accepts.get('*') ?? 0 }))
    .filter(item => item.quality > 0 && item.quality <= 1).sort((a, b) => b.quality - a.quality);
  const encoding = options[0]?.name;
  if (!encoding) return { body: data, headers: { Vary: 'Accept-Encoding' } };
  let entry = entries.get(key);
  if (!entry || !entry.source.equals(data)) {
    if (entries.size >= 64) entries.delete(entries.keys().next().value);
    entry = { source: data }; entries.set(key, entry);
  }
  try {
    // Share an in-flight compression across simultaneous requests, and reuse
    // it until the source changes. No per-visitor data enters this cache.
    entry[encoding] ||= encoding === 'br'
      ? brotli(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }) : gzip(data, { level: 6 });
    const body = await entry[encoding];
    return body.length < data.length ? { body, headers: { Vary: 'Accept-Encoding', 'Content-Encoding': encoding } }
      : { body: data, headers: { Vary: 'Accept-Encoding' } };
  } catch { delete entry[encoding]; return { body: data, headers: { Vary: 'Accept-Encoding' } }; }
};
