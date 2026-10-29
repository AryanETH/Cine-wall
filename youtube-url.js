'use strict';

function extractYouTubeId(value) {
  const input = String(value || '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  // Mobile share sheets can include a title alongside the link.
  const shared = input.match(/https?:\/\/[^\s<>"']+/i)?.[0] || input;
  let url;
  try { url = new URL(/^https?:\/\//i.test(shared) ? shared : `https://${shared}`); }
  catch { throw Error('Paste a valid YouTube link.'); }
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || !['youtu.be', 'youtube.com', 'youtube-nocookie.com'].includes(host)) throw Error('Paste a valid YouTube link.');
  if (url.pathname === '/attribution_link') {
    const linked = new URL(url.searchParams.get('u') || '', 'https://www.youtube.com');
    if (linked.hostname !== 'www.youtube.com' || linked.pathname !== '/watch') throw Error('Paste a direct YouTube video link.');
    url = linked;
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const candidate = host === 'youtu.be' ? parts[0] : parts[0] === 'watch' ? url.searchParams.get('v')
    : ['shorts', 'embed', 'live', 'v'].includes(parts[0]) ? parts[1] : '';
  if (!/^[a-zA-Z0-9_-]{11}$/.test(candidate || '')) throw Error('This YouTube link does not contain a valid video ID.');
  return candidate;
}

module.exports = { extractYouTubeId };
