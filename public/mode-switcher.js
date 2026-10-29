'use strict';

/**
 * CineWall Mode Switcher
 * 
 * Enables persistent room IDs when switching between modes.
 * If a room already exists, switch modes within it instead of creating a new room.
 */
(() => {
  // Wait for CineWallSession to initialize
  const waitForSession = new Promise(resolve => {
    if (window.CineWallSession?.storage) {
      resolve();
    } else {
      const check = setInterval(() => {
        if (window.CineWallSession?.storage) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    }
  });

  document.addEventListener('DOMContentLoaded', async () => {
    await waitForSession;

    // Get the last active room from storage
    const getActiveRoom = () => {
      try {
        return window.CineWallSession.storage.get('cinewall-active-room');
      } catch {
        return null;
      }
    };

    // Get room membership data
    const getRoomMembership = (roomId) => {
      if (!roomId) return null;
      try {
        const data = window.CineWallSession.storage.get(`cinewall-room-${roomId}`);
        return data ? JSON.parse(data) : null;
      } catch {
        return null;
      }
    };

    // Check if user is admin of a room
    const isRoomAdmin = (membership) => {
      return membership && membership.admin === true;
    };

    // Handle mode card clicks
    document.addEventListener('click', async (event) => {
      const modeCard = event.target.closest('a[data-session-mode], .mode-card[data-session-mode]');
      
      if (!modeCard) return;

      const targetMode = modeCard.dataset.sessionMode;
      if (!['video', 'audio', 'share', 'mic'].includes(targetMode)) return;

      // Check if we have an active room and the user is admin
      const activeRoomId = getActiveRoom();
      const membership = getRoomMembership(activeRoomId);

      if (activeRoomId && membership && isRoomAdmin(membership)) {
        // Prevent default navigation
        event.preventDefault();
        event.stopImmediatePropagation();

        try {
          // Use the switchMode API to change modes within the same room
          await window.CineWallSession.switchMode(targetMode);
          
          // switchMode will navigate automatically, but if it doesn't:
          // The session.js switchMode already calls navigate(data)
        } catch (error) {
          console.error('Mode switch failed:', error);
          // Fall back to creating a new room (let default action proceed)
          window.location.href = modeCard.href;
        }
      }
      // If no active room or not admin, let the default link work (creates new room)
    }, true); // Use capture phase to intercept before device-support.js

    // Also handle logo clicks - if user has an active room, go to that room's dashboard
    const brandLockup = document.querySelector('.brand-lockup');
    if (brandLockup && brandLockup.getAttribute('href') === '/') {
      brandLockup.addEventListener('click', (event) => {
        const activeRoomId = getActiveRoom();
        const membership = getRoomMembership(activeRoomId);
        
        if (activeRoomId && membership && isRoomAdmin(membership)) {
          // Go to the admin dashboard for current room instead of homepage
          event.preventDefault();
          const mode = membership.mode || 'video';
          const path = mode === 'share' ? '/share.html' : 
                      mode === 'mic' ? '/mic.html' : 
                      `/admin.html?mode=${mode}`;
          window.location.href = window.CineWallSession.link(path);
        }
      });
    }
  });
})();
