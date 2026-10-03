'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('dashboard tutorial opens the supplied YouTube link separately without replacing the source tab', () => {
  const html = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
  const link = html.match(/<a id="tutorialLink"[^>]*>[\s\S]*?<\/a>/)?.[0];
  assert.ok(link);
  assert.match(link, /href="https:\/\/www\.youtube\.com\/watch\?v=nKjiv6_XSN4"/);
  assert.match(link, /target="_blank"/);
  assert.match(link, /rel="noopener noreferrer"/);
  assert.match(link, />Tutorial<\/a>/);
  assert.doesNotMatch(link, /data-session-mode|data-sharing|onclick/);
});

test('README includes a GitHub-compatible clickable tutorial thumbnail and a fallback text link', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /## Video tutorial\s+\[!\[Watch the CineWall tutorial on YouTube\]\(https:\/\/img\.youtube\.com\/vi\/nKjiv6_XSN4\/hqdefault\.jpg\)\]\(https:\/\/www\.youtube\.com\/watch\?v=nKjiv6_XSN4\)/);
  assert.match(readme, /\[Watch the tutorial on YouTube\]\(https:\/\/www\.youtube\.com\/watch\?v=nKjiv6_XSN4\)/);
  assert.doesNotMatch(readme, /<iframe/);
});
