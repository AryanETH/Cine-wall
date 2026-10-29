'use strict';

/**
 * CineWall Dashboard Mode Switcher
 * 
 * Intercepts homepage navigation from dashboards to stay in the same room
 */
(() => {
  document.addEventListener('DOMContentLoaded', () => {
    // Handle brand lockup click (logo) - prevent going to homepage, stay in room
    const brandLockup = document.querySelector('.brand-lockup');
    if (brandLockup) {
      brandLockup.addEventListener('click', (event) => {
        // If clicking the logo, redirect to homepage WITH the room parameter
        // so user can switch modes within the same room
        if (window.CineWallSession?.room) {
          event.preventDefault();
          const homeUrl = window.CineWallSession.link('/');
          window.location.href = homeUrl;
        }
      });
    }

    // Mode switch button in header
    const modeSwitch = document.querySelector('.mode-switch');
    if (modeSwitch) {
      modeSwitch.addEventListener('click', (event) => {
        // If there's a room, go to homepage with room parameter
        if (window.CineWallSession?.room) {
          event.preventDefault();
          const homeUrl = window.CineWallSession.link('/');
          window.location.href = homeUrl;
        }
      });
    }
  });
})();
