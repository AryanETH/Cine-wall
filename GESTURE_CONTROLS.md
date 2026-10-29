# Video hand controls

Open video mode → Settings → Hand gestures. The ON setting follows the active dashboard/Display 1 player tab for this room and browser device. Display 1 also has a Hand gestures menu. Camera access needs HTTPS or localhost. Select a laptop camera or attached webcam in settings or in the practice dialog.

| Gesture | Video action |
| --- | --- |
| Open palm | Play |
| Closed fist | Pause |
| Thumbs up / down | This laptop's volume +10% / −10% |
| Victory sign | Forward 10 seconds |
| Thumb, index and little finger raised | Back 10 seconds |

Hold one clearly visible hand for 650ms. Lower the hand for 400ms between commands. Multiple hands and low-confidence classifications are ignored. Play/pause/seek use the existing synchronized room commands; volume uses the existing admin volume control. Locked source owners, pending preparation and other modes cannot issue gesture commands.

First use opens a six-pose live practice. Only the expected pose advances the step; practice never sends playback commands. Completion is remembered locally, with Practice again available. Cancelling, switching off, changing mode/ownership, camera loss or errors release camera tracks and terminate the worker. Hiding/closing a tab releases its camera without clearing the ON setting, so a visible, authorized Display 1/dashboard tab can take over. Web Locks ensure one camera owner. Turning OFF from either tab stops both. Stored intent is scoped to the room and browser device, renews only while active, and expires two minutes after the last active owner. Different sites/ports, browser profiles, guest displays and other laptops do not inherit consent.

MediaPipe Tasks Vision 1.2.0 and its official gesture model are served locally. CPU inference runs in a dedicated worker, with one frame in flight at a time, at up to 10 frames per second. No camera frames are uploaded or recorded. WebAssembly compilation is allowed only on the recognition worker's response policy. See public/vendor/mediapipe/README.md for sources, license and model hash.

Verification: `node --test tests/hand-controls.test.js tests/hand-tabs.test.js tests/audio-source.test.js`. Tests cover confidence and one-hand gating, held-pose repeat prevention, first-use matching, cancellation, camera races/switching, admin↔player handoff, expiry/room isolation, exclusive ownership and both pages' synchronized playback routing. Recognition also needs an actual-camera tryout for lighting, hand positions and each device's performance.
