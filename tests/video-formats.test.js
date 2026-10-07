'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const ffmpeg = process.platform === 'win32' ? path.join(root, 'tools/ffmpeg.exe') : 'ffmpeg';
const validation = require('../public/video-validation');

test('MKV validates H.264 profiles and dual HE-AAC tracks, skips huge payloads and shares the same detected codecs', async () => {
  const size = (value) => {
    const bytes = Buffer.alloc(8);
    bytes.writeBigUInt64BE((1n << 56n) | BigInt(value));
    return bytes;
  };
  const element = (id, payload) => Buffer.concat([Buffer.from(id, 'hex'), size(payload.length), payload]);
  const doc = element('1a45dfa3', element('4282', Buffer.from('matroska')));
  const segmentHeader = Buffer.from('1853806701ffffffffffffff', 'hex'); // Unknown-size segment is valid.
  const track = (kind, codec, privateData) => element('ae', Buffer.concat([
    element('83', Buffer.from([kind])), element('86', Buffer.from(codec)),
    ...(privateData ? [element('63a2', privateData)] : []),
  ]));
  const video = track(1, 'V_MPEG4/ISO/AVC', Buffer.from([1, 77, 0, 40, 255, 225, 0]));
  const aac = track(2, 'A_AAC', Buffer.from([0x11, 0x90]));
  const heAac = track(2, 'A_AAC', Buffer.from([0x2b, 0x92, 0x08, 0]));
  const subtitle = track(17, 'S_TEXT/UTF8');
  const tracks = element('1654ae6b', Buffer.concat([video, aac, heAac, subtitle]));
  const hugeSize = 12 * 1024 ** 3, prefix = Buffer.concat([doc, segmentHeader, Buffer.from('ec', 'hex'), size(hugeSize)]);
  const metadataStart = prefix.length + hugeSize, reads = [];
  const file = { name: 'dual-audio.MKV', size: metadataStart + tracks.length, slice(start, end) {
    reads.push([start, end]);
    assert.ok(end - start <= 4096, 'no video payload should be buffered');
    const bytes = Buffer.alloc(end - start);
    for (const [offset, part] of [[0, prefix], [metadataStart, tracks]]) {
      const from = Math.max(offset, start), to = Math.min(offset + part.length, end);
      if (from < to) part.copy(bytes, from - start, from - offset, to - offset);
    }
    return new Blob([bytes]);
  } };
  assert.equal(await validation.inspect(file), 'video/x-matroska');
  assert.deepEqual(await validation.inspectMkvCodecs(file), ['V_MPEG4/ISO/AVC', 'A_AAC']);
  assert.ok(reads.reduce((total, [start, end]) => total + end - start, 0) < 2000);
  const peerContext = { window: { CineWallVideoFile: validation } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/media-peer.js'), 'utf8'), peerContext);
  assert.deepEqual(await peerContext.window.CineWallFilePeer.inspectCodecs(file), ['V_MPEG4/ISO/AVC', 'A_AAC']);
  for (const rejected of [
    track(1, 'V_MPEG4/ISO/AVC', Buffer.from([1, 110, 0, 40, 255, 225, 0])),
    track(1, 'V_MPEG4/ISO/AVC'),
    track(2, 'A_EAC3', Buffer.from([1, 2])),
    track(2, 'A_AAC', Buffer.from([0xf8, 0])), // Unsupported extended AAC object type.
  ]) {
    const bytes = Buffer.concat([doc, segmentHeader, element('1654ae6b', Buffer.concat([video, aac, rejected]))]);
    await assert.rejects(validation.inspect(new File([bytes], 'unsupported.mkv')), /not supported/);
  }
});

test('compatible MKV/MP4 are accepted; unsupported tracks, renamed containers and broken metadata are rejected without conversion', { timeout: 30000, skip: process.platform === 'win32' && !fs.existsSync(ffmpeg) }, async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cinewall-formats-test-'));
  t.after(() => { if (path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('cinewall-formats-test-')) fs.rmSync(temporary, { recursive: true, force: true }); });
  process.env.CINEWALL_CACHE_DIR = path.join(temporary, 'cache');
  const { inspectBrowserVideo } = require('../youtube-downloads');
  const base = ['-nostdin', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '0.3'];
  async function clip(name, args, supported) {
    const filePath = path.join(temporary, name);
    execFileSync(ffmpeg, [...base, ...args, filePath], { windowsHide: true });
    const original = fs.readFileSync(filePath), file = new File([original], name);
    const extension = path.extname(name);
    if (supported) {
      assert.equal(await validation.inspect(file), extension.toLowerCase() === '.mkv' ? 'video/x-matroska' : 'video/mp4');
      assert.equal((await inspectBrowserVideo(filePath, extension)).video, typeof supported === 'string' ? supported : 'h264');
    } else {
      await assert.rejects(validation.inspect(file), /not supported.*H\.264/);
      await assert.rejects(inspectBrowserVideo(filePath, extension), /Use MP4/);
    }
    assert.deepEqual(fs.readFileSync(filePath), original, 'validation must leave all video bytes untouched');
    return original;
  }
  const mp4 = await clip('supported.mp4', ['-c:v', 'libx264', '-c:a', 'aac'], true);
  await clip('youtube-vp9.mp4', ['-c:v', 'libvpx-vp9', '-c:a', 'aac'], 'vp9');
  await clip('youtube-av1.mp4', ['-c:v', 'libaom-av1', '-cpu-used', '8', '-c:a', 'aac'], 'av1');
  await clip('supported.M4V', ['-c:v', 'libx264', '-c:a', 'aac', '-f', 'mp4'], true);
  const mkv = await clip('video.mkv', ['-map', '0:v', '-map', '1:a', '-map', '1:a', '-c:v', 'libx264', '-c:a', 'aac'], true);
  await clip('hevc.mkv', ['-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=error:pools=1:frame-threads=1', '-c:a', 'eac3'], false);
  await clip('dolby.mkv', ['-c:v', 'libx264', '-c:a', 'eac3'], false);
  await clip('hevc.mp4', ['-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=error:pools=1:frame-threads=1', '-c:a', 'aac'], false);
  await clip('dolby.mp4', ['-c:v', 'libx264', '-c:a', 'eac3'], false);
  await clip('mp3-track.mp4', ['-c:v', 'libx264', '-c:a', 'libmp3lame'], false);
  await assert.rejects(validation.inspect(new File([Buffer.from('renamed MKV')], 'renamed.mp4')), /not supported/);
  await assert.rejects(validation.inspect(new File([mp4.subarray(0, 80)], 'broken.mp4')), /not supported/);
  await assert.rejects(validation.inspect(new File([mp4], 'renamed.mkv')), /not supported/);
  await assert.rejects(validation.inspect(new File([mkv], 'renamed.mp4')), /not supported/);
  await assert.rejects(validation.inspect(new File([mkv.subarray(0, 80)], 'broken.mkv')), /not supported/);
  const peerContext = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/media-peer.js'), 'utf8'), peerContext);
  const webmPath = path.join(temporary, 'supported.webm');
  execFileSync(ffmpeg, [...base, '-c:v', 'libvpx-vp9', '-c:a', 'libopus', webmPath], { windowsHide: true });
  const webmBytes = fs.readFileSync(webmPath);
  assert.equal(await validation.inspect(new File([webmBytes], 'movie.webm'), peerContext.window.CineWallFilePeer.matroskaCodecs), 'video/webm');
  assert.equal((await inspectBrowserVideo(webmPath, '.webm')).video, 'vp9');
  const mkvPath = path.join(temporary, 'movie.mkv');
  await assert.rejects(validation.inspect(new File([fs.readFileSync(mkvPath)], 'renamed.webm'), peerContext.window.CineWallFilePeer.matroskaCodecs), /not supported/);

  // Put valid metadata after a virtual 12 GB media box; validation must skip the data.
  const top = [];
  for (let offset = 0; offset < mp4.length;) { const size = mp4.readUInt32BE(offset); top.push({ type: mp4.toString('ascii', offset + 4, offset + 8), bytes: mp4.subarray(offset, offset + size) }); offset += size; }
  const ftyp = top.find((box) => box.type === 'ftyp').bytes, moov = top.find((box) => box.type === 'moov').bytes;
  const movieSize = 12 * 1024 ** 3, mediaHeader = Buffer.alloc(16);
  mediaHeader.writeUInt32BE(1); mediaHeader.write('mdat', 4); mediaHeader.writeBigUInt64BE(BigInt(movieSize), 8);
  const metadataStart = ftyp.length + movieSize, reads = [];
  const large = { name: '12gb.mp4', size: metadataStart + moov.length, slice(start, end) {
    reads.push([start, end]);
    const bytes = start < ftyp.length ? ftyp.subarray(start, end) : start === ftyp.length ? mediaHeader : moov.subarray(start - metadataStart, end - metadataStart);
    return new Blob([bytes]);
  } };
  assert.equal(await validation.inspect(large), 'video/mp4');
  assert.ok(reads.reduce((total, [start, end]) => total + end - start, 0) < 10000);

  // A supported container can still fail in the current browser: verify real
  // decode failure is rejected and its temporary element/URL are released.
  for (const [movie, name, fail, claimsSupport] of [[mp4, 'movie.mp4', false, true], [mp4, 'movie.mp4', true, true], [mkv, 'movie.mkv', false, false], [mkv, 'movie.mkv', true, true]]) {
    const handlers = {}, released = [], module = { exports: {} };
    const probe = { style: {}, videoWidth: 320, videoHeight: 180, canPlayType: () => claimsSupport ? 'probably' : '', setAttribute() {},
      addEventListener(name, fn) { handlers[name] = fn; }, requestVideoFrameCallback(fn) { this.frame = fn; return 1; }, cancelVideoFrameCallback() {},
      load() { if (this.src) queueMicrotask(() => fail ? handlers.error() : handlers.loadedmetadata()); }, play() { queueMicrotask(() => this.frame()); return Promise.resolve(); },
      pause() {}, removeAttribute() { this.src = ''; }, remove() { released.push('element'); } };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'public/video-validation.js'), 'utf8'), {
      module, window: {}, document: { createElement: () => probe, body: { appendChild() {} } }, setTimeout, clearTimeout,
      URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => released.push('url') },
    });
    const check = module.exports.validate(new File([movie], name));
    if (fail) await assert.rejects(check, /not supported/); else await check;
    assert.deepEqual(released, ['element', 'url']);
  }
});
