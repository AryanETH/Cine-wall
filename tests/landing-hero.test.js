'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const publicDir = path.resolve(__dirname, '../public');

test('homepage uses a silent 16:9 demo without controls or fullscreen affordances', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const hero = html.match(/<section class="mode-hero">([\s\S]*?)<\/section>/)[1];
  const videoTag = hero.match(/<video[^>]+>/)[0];
  assert.match(videoTag, /autoplay muted loop playsinline preload="metadata"/);
  assert.doesNotMatch(videoTag, /\scontrols(?:\s|=|>)/);
  assert.match(videoTag, /controlslist="nodownload nofullscreen noremoteplayback"/);
  assert.match(videoTag, /disablepictureinpicture disableremoteplayback draggable="false" tabindex="-1"/);
  assert.match(videoTag, /width="1440" height="810"/);
  assert.match(hero, /poster="\/assets\/cinewall-demo-poster\.jpg\?v=[^"]+"/);
  assert.match(hero, /<source src="\/assets\/cinewall-demo\.mp4\?v=[^"]+" type="video\/mp4">/);
  assert.doesNotMatch(hero, /toggleHomeDemo|Pause demo|Explore tools|Open video wall/);
  assert.match(hero, />Try free /);
  assert.match(hero, />More from CineWall</);
  assert.match(hero, /id="homeDemoFallback"[^>]+hidden/);
  assert.ok(hero.indexOf('<h1>') < hero.indexOf('<video'));
  const video = fs.readFileSync(path.join(publicDir, 'assets/cinewall-demo.mp4'));
  assert.ok(video.length < 12000000, 'full-length demo stays below 12 MB');
  assert.equal(video.toString('ascii', 4, 8), 'ftyp');
  assert.ok(video.subarray(0, 100000).includes(Buffer.from('moov')), 'metadata precedes the video for quick starts');
  const poster = fs.readFileSync(path.join(publicDir, 'assets/cinewall-demo-poster.jpg'));
  assert.equal(poster.subarray(0, 2).toString('hex'), 'ffd8');
});

test('landing page keeps the existing type and four entry points with a short FAQ', () => {
  const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  assert.match(html, /href="\/fonts\/Anta-Regular\.ttf" as="font" type="font\/ttf" crossorigin/);
  assert.match(css, /@font-face \{ font-family: "Anta"; src: url\('\/fonts\/Anta-Regular\.ttf'\) format\('truetype'\)/);
  assert.match(css, /\.mode-hero h1 \{[^}]+font-family: "Anta", "Segoe UI", sans-serif;[^}]+font-weight: 400;/);
  const font = fs.readFileSync(path.join(publicDir, 'fonts/Anta-Regular.ttf'));
  assert.ok(font.length > 50000 && font.length < 100000);
  assert.ok(fs.readFileSync(path.join(publicDir, 'fonts/OFL.txt'), 'utf8').includes('SIL OPEN FONT LICENSE'));
  for (const href of ['/admin.html?mode=video', '/admin.html?mode=audio', '/share.html', '/mic.html']) assert.ok(html.includes(`href="${href}"`));
  const faq = html.match(/<section id="faq"[\s\S]*?(?=<footer)/)[0];
  assert.equal((faq.match(/<details/g) || []).length, 5);
  assert.doesNotMatch(html, /id="about"|id="use-cases"|home-faq-nav/);
  assert.match(faq, /Laptop edges stay visible/);
});

const { setupHomeDemo } = require('../public/home-demo.js');
function demoFixture(reduced = false, blocked = false) {
  const events = {}, sourceEvents = {}, surfaceEvents = {}, motionEvents = {};
  const surface = { addEventListener(name, fn) { surfaceEvents[name] = fn; } };
  const video = { paused: true, plays: 0, addEventListener(name, fn) { events[name] = fn; },
    closest() { return surface; },
    querySelector() { return { addEventListener(name, fn) { sourceEvents[name] = fn; } }; },
    play() { this.plays++; if (blocked) return Promise.reject(new Error('Autoplay denied')); this.paused = false; events.play?.(); return Promise.resolve(); },
    pause() { this.paused = true; events.pause?.(); } };
  const fallback = { hidden: true };
  const motion = { matches: reduced, addEventListener(name, fn) { motionEvents[name] = fn; } };
  setupHomeDemo(video, fallback, motion);
  return { video, fallback, fail: sourceEvents.error, surfaceEvents, setMotion(value) { motion.matches = value; motionEvents.change(); } };
}

test('reduced motion leaves a still poster and changes to the preference update playback', () => {
  const demo = demoFixture(true);
  assert.equal(demo.video.plays, 0);
  assert.equal(demo.video.paused, true);
  demo.setMotion(false);
  assert.equal(demo.video.paused, false);
  demo.setMotion(true);
  assert.equal(demo.video.paused, true);
});

test('double-click, context menu and dragging are blocked on the demo surface', () => {
  const demo = demoFixture();
  for (const type of ['dblclick', 'contextmenu', 'dragstart']) {
    const event = { prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    demo.surfaceEvents[type](event);
    assert.equal(event.prevented, true, type + ' must not invoke a native video action');
    assert.equal(event.stopped, true);
  }
});

test('blocked autoplay is handled and missing media reveals the tutorial fallback', async () => {
  const demo = demoFixture(false, true);
  await Promise.resolve();
  assert.equal(demo.video.paused, true);
  demo.fail();
  assert.equal(demo.fallback.hidden, false);
});
