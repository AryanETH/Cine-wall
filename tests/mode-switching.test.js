'use strict';

const assert = require('node:assert/strict');
const { describe, it, beforeEach } = require('node:test');
const path = require('node:path');
const createRooms = require('../rooms');
const fs = require('node:fs');
const os = require('node:os');

describe('Mode Switching Persistence', () => {
  let rooms, root, time;
  
  beforeEach(() => {
    time = 1000000000;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cinewall-mode-switch-'));
    rooms = createRooms(root, { now: () => time });
  });

  const request = () => {
    const id = require('crypto').randomUUID();
    const key = require('crypto').randomUUID();
    return {
      headers: { 'x-cinewall-device': id, 'x-cinewall-key': key },
      socket: { remoteAddress: '127.0.0.1' }
    };
  };

  it('should preserve room ID when admin switches modes', () => {
    const admin = request();
    
    // Create initial video room
    const created = rooms.create(admin, 'video');
    const initialRoomId = created.room;
    const initialCode = created.code;
    
    assert.equal(created.mode, 'video');
    assert.ok(initialRoomId);
    assert.ok(initialCode);
    
    // Get the room record
    const record = rooms.lookup(initialRoomId);
    
    // Switch to audio mode
    rooms.switchMode(record, admin, 'audio');
    assert.equal(record.mode, 'audio');
    assert.equal(record.id, initialRoomId, 'Room ID should not change');
    
    // Verify result still has same room and code
    const result = rooms.result(record, record.members[0]);
    assert.equal(result.room, initialRoomId);
    assert.equal(result.code, initialCode);
    assert.equal(result.mode, 'audio');
    
    // Switch to screen sharing
    rooms.switchMode(record, admin, 'share');
    assert.equal(record.mode, 'share');
    assert.equal(record.id, initialRoomId, 'Room ID should not change');
    
    // Switch to mic mode
    rooms.switchMode(record, admin, 'mic');
    assert.equal(record.mode, 'mic');
    assert.equal(record.id, initialRoomId, 'Room ID should not change');
  });

  it('should update member assignments when switching modes', () => {
    const admin = request();
    const guest1 = request();
    const guest2 = request();
    
    // Create video room and add guests
    const created = rooms.create(admin, 'video');
    rooms.join(guest1, { code: created.code });
    rooms.join(guest2, { code: created.code });
    
    const record = rooms.lookup(created.room);
    assert.equal(record.members.length, 3);
    
    // Verify initial assignments (video mode: screens 1, 2, 3)
    assert.equal(record.members[0].screen, 1); // Admin
    assert.equal(record.members[1].screen, 2); // Guest 1
    assert.equal(record.members[2].screen, 3); // Guest 2
    
    // Switch to audio mode (allows up to 5 speakers)
    rooms.switchMode(record, admin, 'audio');
    assert.equal(record.mode, 'audio');
    assert.equal(record.members[0].screen, 1); // Admin still speaker 1
    assert.equal(record.members[1].screen, 2); // Guest 1 still assigned
    assert.equal(record.members[2].screen, 3); // Guest 2 still assigned
    
    // Switch to share mode
    rooms.switchMode(record, admin, 'share');
    assert.equal(record.mode, 'share');
    assert.equal(record.members[0].screen, 0); // Admin becomes host (screen 0)
    assert.equal(record.members[1].screen, 1); // Guest 1 becomes screen 1
    assert.equal(record.members[2].screen, 2); // Guest 2 becomes screen 2
  });

  it('should persist room and mode across server restarts', () => {
    const admin = request();
    
    // Create room and switch mode
    const created = rooms.create(admin, 'video');
    const record = rooms.lookup(created.room);
    rooms.switchMode(record, admin, 'audio');
    
    // Create new room manager (simulating server restart)
    const restarted = createRooms(root, { now: () => time });
    
    // Resume the session
    const resumed = restarted.resume(admin, { 
      room: created.room, 
      ticket: created.ticket 
    });
    
    assert.equal(resumed.room, created.room);
    assert.equal(resumed.mode, 'audio', 'Mode should persist across restart');
    assert.equal(resumed.code, created.code);
  });

  it('should allow guests to rejoin after mode switch', () => {
    const admin = request();
    const guest = request();
    
    // Create video room and add guest
    const created = rooms.create(admin, 'video');
    const joined = rooms.join(guest, { code: created.code });
    
    // Switch mode
    const record = rooms.lookup(created.room);
    rooms.switchMode(record, admin, 'audio');
    
    // Guest resumes with their ticket
    const resumed = rooms.resume(guest, { 
      room: created.room, 
      ticket: joined.ticket 
    });
    
    assert.equal(resumed.room, created.room);
    assert.equal(resumed.mode, 'audio');
    assert.equal(resumed.waiting, false, 'Guest should not be waiting');
  });

  it('should prevent non-admin from switching modes', () => {
    const admin = request();
    const guest = request();
    
    const created = rooms.create(admin, 'video');
    rooms.join(guest, { code: created.code });
    
    const record = rooms.lookup(created.room);
    
    // Guest attempts to switch mode
    assert.throws(
      () => rooms.switchMode(record, guest, 'audio'),
      { status: 403 },
      'Non-admin should not be able to switch modes'
    );
  });

  it('should handle phone role correctly across mode switches', () => {
    const admin = request();
    const phone = request();
    
    // Create mic room
    const created = rooms.create(admin, 'mic');
    const joined = rooms.join(phone, { 
      code: created.code, 
      role: 'phone',
      deviceKind: 'phone'
    });
    
    assert.equal(joined.role, 'phone');
    assert.equal(joined.screen, 0);
    
    const record = rooms.lookup(created.room);
    
    // Switch to video mode
    rooms.switchMode(record, admin, 'video');
    
    // Phone should be marked as waiting in video mode
    const resumed = rooms.resume(phone, { 
      room: created.room, 
      ticket: joined.ticket 
    });
    
    assert.equal(resumed.waiting, true, 'Phone should be waiting in video mode');
    
    // Switch back to mic mode
    rooms.switchMode(record, admin, 'mic');
    
    // Phone should be active again
    const resumedAgain = rooms.resume(phone, { 
      room: created.room, 
      ticket: joined.ticket 
    });
    
    assert.equal(resumedAgain.waiting, false, 'Phone should be active in mic mode');
    assert.equal(resumedAgain.role, 'phone');
  });
});
