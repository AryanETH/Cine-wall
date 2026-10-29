# CineWall Mode Switching with Persistent Room IDs

## Problem Statement

Previously, when users clicked on a different mode (Video, Audio, Screen Sharing, or Mic) from the homepage or clicked the logo and then selected a mode, CineWall would create a **new room with a new room ID**. This meant:

❌ Users had to share new links every time they switched modes  
❌ Guest devices would be disconnected and need new links  
❌ Room history and session continuity were lost  

**Example of the old behavior:**
```
1. Open homepage → Click "Video" → Get room ID: 82153afc-8905-477e-bb39-19ce9218f2a6
2. Click logo → Click "Audio" → Get NEW room ID: ea2b5668-ac96-4d40-9893-edcd77ebb9df
3. Share new link to guests again! 😞
```

## Solution

The new **persistent room ID** feature ensures that when an admin (room creator) switches modes, they stay in the **same room** with the **same room ID and code**. This means:

✅ One room ID stays the same across all 4 modes  
✅ Guests can keep using their original links  
✅ No need to re-share links when changing modes  
✅ Seamless mode switching experience  

**Example of the new behavior:**
```
1. Open homepage → Click "Video" → Get room ID: 82153afc-8905-477e-bb39-19ce9218f2a6
2. Click logo → Click "Audio" → SAME room ID: 82153afc-8905-477e-bb39-19ce9218f2a6
3. Guests stay connected with their original links! ✨
```

## How It Works

### Backend (Server-Side)

**Room Management** (`rooms.js`)
- The `switchMode()` function allows admins to change modes within an existing room
- Room ID, code, and recovery key remain unchanged
- Member assignments are updated based on the new mode's requirements
- Room revision number increments to notify connected clients

**Key Changes:**
```javascript
// rooms.js - switchMode function
function switchMode(record, req, mode) {
  requireAdmin(record, req);
  if (!['video', 'audio', 'share', 'mic'].includes(mode)) 
    fail('Choose Video, Audio, Screen sharing or Mic and Speaker.');
  
  if (record.mode === mode) return;
  
  record.mode = mode;
  record.revision = (record.revision || 0) + 1;
  
  // Reassign members based on new mode constraints
  // Save changes to persistent storage
}
```

### Frontend (Client-Side)

**1. Homepage Mode Switcher** (`public/mode-switcher.js`)

When a user clicks a mode card on the homepage:
1. Check if there's an active room in localStorage
2. Check if the user is the admin of that room
3. If yes: Use the `switchMode` API instead of creating a new room
4. If no: Create a new room (original behavior)

**Key Features:**
- Intercepts mode card clicks before navigation
- Uses `window.CineWallSession.switchMode(mode)` API
- Preserves admin privileges and room context
- Falls back gracefully if API fails

```javascript
// Intercepts clicks on mode cards
document.addEventListener('click', async (event) => {
  const modeCard = event.target.closest('a[data-session-mode]');
  if (!modeCard) return;
  
  const targetMode = modeCard.dataset.sessionMode;
  const activeRoomId = getActiveRoom();
  const membership = getRoomMembership(activeRoomId);
  
  if (activeRoomId && membership && isRoomAdmin(membership)) {
    event.preventDefault();
    await window.CineWallSession.switchMode(targetMode);
  }
});
```

**2. Dashboard Mode Switcher** (`public/mode-switcher-dashboard.js`)

Handles logo clicks from within dashboards:
1. When clicking the logo from a dashboard (admin/share/mic)
2. Redirect to homepage WITH the room parameter
3. This allows mode selection while staying in the same room

```javascript
// Intercepts logo clicks from dashboards
brandLockup.addEventListener('click', (event) => {
  if (window.CineWallSession?.room) {
    event.preventDefault();
    const homeUrl = window.CineWallSession.link('/');
    window.location.href = homeUrl;
  }
});
```

**3. Session Management** (`public/session.js`)

The existing session.js already has:
- `switchMode(mode)` API function
- `POST /api/rooms/mode` endpoint integration
- Automatic navigation after mode switch
- Room state persistence in localStorage

## User Experience Flow

### Scenario 1: Admin Switches Modes

**Before (Old Behavior):**
```
1. Admin opens video mode: watch.aitoyz.in/admin.html?room=ROOM-A
2. Shares display links with guests
3. Admin clicks logo → clicks "Audio"
4. New room created: watch.aitoyz.in/admin.html?room=ROOM-B ❌
5. Old guest links stop working
6. Admin must share new links
```

**After (New Behavior):**
```
1. Admin opens video mode: watch.aitoyz.in/admin.html?room=ROOM-A
2. Shares display links with guests
3. Admin clicks logo → clicks "Audio"
4. Same room: watch.aitoyz.in/admin.html?mode=audio&room=ROOM-A ✅
5. Guest links still work! (auto-refreshes to new mode)
6. No need to re-share links
```

### Scenario 2: Guest Behavior

**Guest Links Still Work:**
- When admin switches modes, guests can continue using their original device link
- The room system automatically reassigns their role/screen based on the new mode
- Guests may see a "waiting" state if the new mode has fewer slots than their assigned number

**Example:**
```
Guest has: watch.aitoyz.in/screen.html?screen=2&room=ROOM-A

Admin switches from Video (3 screens) → Mic mode (phone + 3 speakers)
Guest's link adapts: Now becomes "Speaker 2" in mic mode
```

### Scenario 3: Phone User in Mic Mode

**Cross-Mode Handling:**
- Phone users joining as microphone are marked with `role: 'phone'` and `phone: true`
- When admin switches from Mic → Video/Audio, phone user is put in "waiting" state
- When switching back to Mic mode, phone user is automatically restored

## API Reference

### Backend Endpoint

**POST /api/rooms/mode**

Request:
```json
{
  "mode": "audio"  // "video" | "audio" | "share" | "mic"
}
```

Response:
```json
{
  "room": "82153afc-8905-477e-bb39-19ce9218f2a6",
  "code": "ABCD-1234",
  "mode": "audio",
  "revision": 2,
  "deviceId": "device-uuid",
  "admin": true,
  "screen": 1,
  "ticket": "access-token",
  "path": "/admin.html?mode=audio"
}
```

### Frontend API

**window.CineWallSession.switchMode(mode)**

```javascript
// Switch to audio mode within current room
try {
  await window.CineWallSession.switchMode('audio');
  // Navigation happens automatically
} catch (error) {
  console.error('Mode switch failed:', error);
}
```

## Testing

### Unit Tests

Run the mode switching test suite:
```bash
node --test tests/mode-switching.test.js
```

**Test Coverage:**
- ✅ Preserves room ID when admin switches modes
- ✅ Updates member assignments when switching modes
- ✅ Persists room and mode across server restarts
- ✅ Allows guests to rejoin after mode switch
- ✅ Prevents non-admin from switching modes
- ✅ Handles phone role correctly across mode switches

### Manual Testing

**Test Scenario 1: Admin Mode Switch**
1. Open homepage
2. Click "Video" mode
3. Note the room ID in the URL
4. Click the logo
5. Click "Audio" mode
6. Verify the room ID is the same

**Test Scenario 2: Guest Link Persistence**
1. Admin creates video room
2. Admin shares Screen 2 link with guest
3. Guest opens link and sees video player
4. Admin switches to Audio mode
5. Guest page auto-refreshes to audio speaker
6. Guest link still works without re-sharing

**Test Scenario 3: Multiple Mode Switches**
1. Start with Video mode
2. Switch to Audio → same room ID
3. Switch to Screen Sharing → same room ID
4. Switch to Mic → same room ID
5. Switch back to Video → same room ID

## File Changes

### New Files Created
- `public/mode-switcher.js` - Homepage mode switching logic
- `public/mode-switcher-dashboard.js` - Dashboard logo handling
- `tests/mode-switching.test.js` - Comprehensive test suite
- `MODE_SWITCHING.md` - This documentation

### Modified Files
- `public/index.html` - Added mode-switcher.js script
- `public/admin.html` - Added mode-switcher-dashboard.js script
- `public/share.html` - Added mode-switcher-dashboard.js script
- `public/mic.html` - Added mode-switcher-dashboard.js script

### No Changes Required
- `rooms.js` - Already had switchMode() function
- `session.js` - Already had switchMode() API wrapper
- `server.js` - Already had /api/rooms/mode endpoint

## Benefits

### For Users
1. **Simplified Workflow** - No need to manage multiple room IDs
2. **Persistent Links** - Share once, use everywhere
3. **Seamless Transitions** - Switch modes without losing context
4. **Better UX** - Less confusion, more intuitive

### For Guests
1. **No Re-joining** - Original link keeps working
2. **Auto-adaptation** - Automatically assigned new role in new mode
3. **Continuous Session** - No interruption in experience

### For Administrators
1. **Easier Management** - One room ID to remember
2. **Faster Setup** - Switch modes on the fly
3. **Recovery Key Persistence** - Same recovery key across all modes

## Limitations & Considerations

### Mode-Specific Constraints

**Screen Assignments:**
- Video: 3 screens max
- Audio: 5 speakers max
- Screen Sharing: 10 screens max
- Mic: 1 phone + 3 speakers max

When switching to a mode with fewer slots, excess members are put in "waiting" state.

**Example:**
```
Audio mode with 5 speakers → Switch to Video (3 screens)
- Speakers 1, 2, 3 → Screens 1, 2, 3 ✅
- Speakers 4, 5 → Waiting state ⏳
```

### Non-Admin Users

Non-admin users **cannot** switch modes. Only the room creator (admin) can:
- Switch between modes
- Change room settings
- Manage devices

Guests will see mode changes reflected automatically but cannot initiate them.

### First-Time Users

Users without an existing room will still create a new room on first click. This is expected behavior:
- First visit → Create new room
- Subsequent mode changes → Use same room

## Browser Compatibility

Mode switching works on all browsers that support CineWall:
- ✅ Chrome/Edge (Desktop)
- ✅ Firefox (Desktop)
- ✅ Safari (Desktop)
- ✅ Mobile browsers (with device restrictions)

Uses standard Web APIs:
- `localStorage` for room persistence
- `fetch` for API calls
- `EventListener` for click interception

## Future Enhancements

Possible improvements for future versions:

1. **Mode History** - Track previous modes for quick switching
2. **Mode Presets** - Save favorite mode configurations
3. **Bulk Guest Migration** - Better handling when switching to modes with fewer slots
4. **Mode Suggestion** - Recommend best mode based on device count
5. **Quick Switch UI** - In-dashboard mode selector dropdown

## Troubleshooting

### Issue: Mode Switch Not Working

**Symptoms:** Clicking mode card creates new room instead of switching

**Possible Causes:**
1. User is not the admin
2. localStorage is disabled
3. Room membership data is corrupted
4. JavaScript error prevented mode-switcher.js from loading

**Solution:**
- Check browser console for errors
- Verify localStorage is enabled
- Clear site data and create a new room
- Ensure mode-switcher.js is loaded before click events

### Issue: Guests Disconnected After Mode Switch

**Symptoms:** Guest links show "room unavailable" after admin switches modes

**Possible Causes:**
1. Guest had an old, invalid ticket
2. Network interruption during mode switch
3. Server-side session expired

**Solution:**
- Guest should refresh their link
- If issue persists, re-share the device link
- Check server logs for room state errors

## Summary

The persistent room ID feature enhances CineWall by:

✅ Maintaining the same room ID across all 4 modes  
✅ Eliminating the need to re-share links  
✅ Providing seamless admin experience  
✅ Preserving guest connections  
✅ Improving overall usability  

This change is **backward compatible** - users without an existing room still create new rooms on first mode selection. The improvement only applies when an admin with an existing room switches modes.
