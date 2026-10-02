'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const ffmpeg = process.platform === 'win32' ? path.join(root, 'tools/ffmpeg.exe') : 'ffmpeg';
const ffprobe = process.platform === 'win32' ? path.join(root, 'tools/ffprobe.exe') : 'ffprobe';

test('MKV remux preserves every compressed audio/video packet and never silently transcodes unsupported codecs', { timeout: 30000, skip: process.platform === 'win32' && !fs.existsSync(ffmpeg) }, async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cinewall-remux-test-'));
  t.after(() => { if (path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('cinewall-remux-test-')) fs.rmSync(temporary, { recursive: true, force: true }); });
  process.env.CINEWALL_CACHE_DIR = path.join(temporary, 'cache');
  const { prepareWallVideo } = require('../youtube-downloads');
  const clip = path.join(temporary, 'original.mkv'), remux = path.join(temporary, 'wall.mp4'), legacy = path.join(temporary, 'unsupported.mkv');
  const args = ['-nostdin', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2'];
  execFileSync(ffmpeg, [...args, '-c:v', 'libx264', '-c:a', 'aac', clip], { windowsHide: true });
  const progress = [], prepared = await prepareWallVideo(clip, remux, { onProgress: (value) => progress.push(value) });
  assert.equal(prepared.path, remux); assert.equal(progress.at(-1), 100); assert.equal(prepared.lossless, true);
  function packets(file, stream) {
    const info = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-select_streams', stream, '-show_packets', '-show_data_hash', 'sha256', '-of', 'json', file], { windowsHide: true, encoding: 'utf8' }));
    return info.packets.map((packet) => packet.data_hash);
  }
  assert.deepEqual(packets(clip, 'v:0'), packets(remux, 'v:0'));
  assert.deepEqual(packets(clip, 'a:0'), packets(remux, 'a:0'));
  const unchanged = await prepareWallVideo(remux, path.join(temporary, 'unneeded.mp4'));
  assert.equal(unchanged.path, remux); assert.equal(unchanged.converted, false); assert.equal(fs.existsSync(path.join(temporary, 'unneeded.mp4')), false);
  execFileSync(ffmpeg, [...args, '-c:v', 'mpeg4', '-c:a', 'aac', legacy], { windowsHide: true });
  await assert.rejects(prepareWallVideo(legacy, path.join(temporary, 'not-consented.mp4')), /Enable lossy compatibility conversion explicitly/);
  assert.equal(fs.existsSync(path.join(temporary, 'not-consented.mp4')), false);
});
