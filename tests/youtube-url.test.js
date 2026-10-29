'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { extractYouTubeId } = require('../youtube-url');
const id = 'YE7VzlLtp-4';
test('YouTube desktop, mobile, music, short and share links normalize to the video ID', () => {
  for (const input of [id, `https://youtube.com/watch?v=${id}&list=RD${id}`, `https://music.youtube.com/watch?v=${id}&si=tracking`,
    `m.youtube.com/watch?v=${id}`, `youtu.be/${id}?t=40`, `https://youtube.com/shorts/${id}`, `https://youtube.com/live/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`, `https://youtube.com/v/${id}`, `Watch this video https://youtu.be/${id}?si=tracking`,
    `https://www.youtube.com/attribution_link?u=${encodeURIComponent(`/watch?v=${id}&feature=share`)}`]) assert.equal(extractYouTubeId(input), id);
});
test('YouTube parsing rejects lookalike hosts, credentials, playlists and unrelated nested redirects', () => {
  for (const input of [`https://youtube.com.evil.example/watch?v=${id}`, `https://evil.example/youtube.com/watch?v=${id}`,
    `https://user:password@youtube.com/watch?v=${id}`, 'https://youtube.com/playlist?list=PLabc', 'https://youtube.com/watch?v=short',
    `https://youtube.com/attribution_link?u=${encodeURIComponent(`https://evil.example/watch?v=${id}`)}`]) assert.throws(() => extractYouTubeId(input), /YouTube/);
});
