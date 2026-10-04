'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const publicDir = path.resolve(__dirname, '../public');

test('homepage uses the bundled studio photo as a decorative, high-priority hero background', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const hero = html.match(/<section class="mode-hero">([\s\S]*?)<\/section>/)[1];
  assert.match(hero, /class="mode-hero-photo"[^>]+src="\/assets\/cinewall-laptops-hero-v2\.png"/);
  assert.match(hero, /alt="" aria-hidden="true"/);
  assert.match(hero, /fetchpriority="high"/);
  assert.ok(hero.indexOf('mode-hero-photo') < hero.indexOf('<h1>'));
  const png = fs.readFileSync(path.join(publicDir, 'assets/cinewall-laptops-hero-v2.png'));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 1915);
  assert.equal(png.readUInt32BE(20), 821);
});

test('hero keeps readable text on the white photograph and adapts its crop for phones', () => {
  const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');
  assert.match(css, /\.mode-hero \{[^}]+isolation: isolate[^}]+background: #fff; color: #080b12/);
  assert.match(css, /\.mode-hero-photo \{[^}]+position: absolute[^}]+pointer-events: none/);
  assert.match(css, /\.mode-hero-photo \{ inset: auto 0 0 auto; width: 165%; height: auto; object-fit: contain; \}/);
  assert.match(css, /\.mode-hero h1 \{ max-width: 100%;/);
});
