'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { create } = require('../public/hand-tabs');
const { sharedTabs } = require('./hand-tabs-fixture.cjs');
function cameraTab(shared, id, { room = 'room-a', device = 'device-a', visible = true, available = true } = {}) {
  const env = shared.tab(id), state = { visible, available, enabled: false, active: false }, history = [];
  const controls = create({ ...env, room, device, visible: () => state.visible, available: () => state.available,
    onChange(value) { Object.assign(state, value); history.push(value); } });
  return { ...env, controls, state, history };
}
test('admin → player → admin handoff keeps ON intent and one exclusive owner', async () => {
  const shared = sharedTabs(), admin = cameraTab(shared, 'admin'), player = cameraTab(shared, 'player', { visible: false, available: false });
  admin.controls.setEnabled(true); await shared.flush(); assert.equal(admin.state.active, true);
  player.controls.sync(); assert.equal(admin.state.enabled, true, 'loading player cannot cancel the admin setting');
  admin.controls.setCamera('usb-webcam');
  admin.state.visible = false; admin.controls.sync();
  player.state.visible = true; player.state.available = true; player.controls.sync();
  await shared.flush();
  assert.equal(admin.state.enabled, true); assert.equal(admin.state.active, false);
  assert.equal(player.state.active, true); assert.equal(player.controls.camera, 'usb-webcam');
  player.state.visible = false; player.controls.sync(); admin.state.visible = true; admin.controls.sync(); await shared.flush();
  assert.equal(admin.state.active, true); assert.equal(player.state.active, false);
  player.controls.setEnabled(false); await shared.flush();
  assert.equal(admin.state.active, false); assert.equal(admin.state.enabled, false); assert.equal(player.state.enabled, false);
  admin.controls.dispose(); player.controls.dispose();
});
test('simultaneously visible tabs serialize ownership, and closing admin releases it to player', async () => {
  const shared = sharedTabs(), admin = cameraTab(shared, 'admin');
  admin.controls.setEnabled(true); await shared.flush();
  const player = cameraTab(shared, 'player'); await shared.flush();
  assert.equal(Number(admin.state.active) + Number(player.state.active), 1);
  admin.controls.dispose(); await shared.flush();
  assert.equal(admin.state.active, false); assert.equal(player.state.active, true);
  player.controls.setEnabled(false); player.controls.dispose();
});
test('different rooms/devices do not inherit consent, and unsupported players never acquire the camera', async () => {
  const shared = sharedTabs(), admin = cameraTab(shared, 'admin'); admin.controls.setEnabled(true); await shared.flush();
  const otherRoom = cameraTab(shared, 'room-b', { room: 'room-b' }), guest = cameraTab(shared, 'guest', { device: 'guest' });
  const disabled = cameraTab(shared, 'audio-or-display2', { available: false }); await shared.flush();
  assert.equal(otherRoom.state.enabled, false); assert.equal(guest.state.enabled, false); assert.equal(disabled.state.active, false);
  for (const tab of [admin, otherRoom, guest, disabled]) tab.controls.dispose();
});
test('active sessions renew intent; abandoned sessions expire and pending acquisition is cancelled', async () => {
  const shared = sharedTabs(), admin = cameraTab(shared, 'admin'); admin.controls.setEnabled(true); await shared.flush();
  shared.advance(90000); admin.tick(); assert.equal(admin.state.enabled, true);
  admin.state.visible = false; admin.controls.sync(); await shared.flush();
  shared.advance(120001); admin.tick(); assert.equal(admin.state.enabled, false);
  admin.state.visible = true; admin.controls.sync(); await shared.flush(); assert.equal(admin.state.active, false); admin.controls.dispose();
});
