'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const publicDir = path.resolve(__dirname, '../public');

test('homepage uses a small silent streaming video with a fast poster fallback', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const hero = html.match(/<section class="mode-hero">([\s\S]*?)<\/section>/)[1];
  assert.match(hero, /<video class="mode-hero-photo"[^>]+autoplay muted loop playsinline preload="metadata"/);
  assert.match(hero, /poster="\/assets\/robots-laptops-poster\.jpg"/);
  assert.match(hero, /<source src="\/assets\/robots-laptops-hero\.mp4" type="video\/mp4">/);
  assert.match(hero, /aria-hidden="true"/);
  assert.ok(hero.indexOf('mode-hero-photo') < hero.indexOf('<h1>'));
  const video = fs.readFileSync(path.join(publicDir, 'assets/robots-laptops-hero.mp4'));
  assert.ok(video.length < 1000000, 'hero loads in under 1 MB');
  assert.equal(video.toString('ascii', 4, 8), 'ftyp');
  assert.ok(video.subarray(0, 100000).includes(Buffer.from('moov')), 'metadata precedes the video for quick starts');
  const poster = fs.readFileSync(path.join(publicDir, 'assets/robots-laptops-poster.jpg'));
  assert.equal(poster.subarray(0, 2).toString('hex'), 'ffd8');
});

test('hero keeps readable text next to the video and adapts its crop for phones', () => {
  const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  assert.match(html, /href="\/fonts\/Anta-Regular\.ttf" as="font" type="font\/ttf" crossorigin/);
  assert.match(css, /@font-face \{ font-family: "Anta"; src: url\('\/fonts\/Anta-Regular\.ttf'\) format\('truetype'\)/);
  assert.match(css, /\.mode-hero h1 \{[^}]+font-family: "Anta", "Segoe UI", sans-serif;[^}]+font-weight: 400;/);
  const font = fs.readFileSync(path.join(publicDir, 'fonts/Anta-Regular.ttf'));
  assert.ok(font.length > 50000 && font.length < 100000);
  assert.ok(fs.readFileSync(path.join(publicDir, 'fonts/OFL.txt'), 'utf8').includes('SIL OPEN FONT LICENSE'));
  assert.match(css, /\.mode-hero \{[^}]+isolation: isolate[^}]+background: #fdfffc; color: #080b12/);
  assert.match(css, /\.mode-hero-photo \{[^}]+position: absolute[^}]+pointer-events: none/);
  assert.match(css, /mask-image: linear-gradient\(to right, transparent, #000 22%\)/);
  assert.match(css, /\.mode-hero-photo \{ inset: auto 0 0 auto; width: 100%; height: 58vw; object-fit: cover;/);
  assert.match(css, /\.mode-hero h1 \{ max-width: 100%;/);
});
