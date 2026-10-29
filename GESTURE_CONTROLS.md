# Video hand controls

Open video mode → Settings → Hand gestures. The ON setting follows the active dashboard/Display 1 player tab for this room and browser device. The last focused eligible CineWall tab owns capture, including when both windows remain visible; passive refreshes cannot take it back. Display 1 also has a Hand gestures menu. Camera access needs HTTPS or localhost. Select a laptop camera or attached webcam in settings or in the practice dialog.

| Gesture | Video action |
| --- | --- |
| Open palm | Play |
| Closed fist | Pause |
| Thumbs up / down | This laptop's volume +10% / −10% |
| Victory sign | Forward 10 seconds |
| Index and little finger raised, thumb relaxed or extended | Back 10 seconds |

Hold a clearly visible gesture for 650ms. Lower the hand for 400ms between commands. A smaller resting hand can remain in view; equally prominent conflicting gestures are ignored. Play/pause/seek use the existing synchronized room commands; volume uses the existing admin volume control. Locked source owners, pending preparation and other modes cannot issue gesture commands.

Recognition combines the model's categories with 3D finger bend and reach. Finger-shape checks accept either hand, palm/back views, wrist rotation, fingers together/apart and a relaxed bend. When detection loses a rotated hand, the worker periodically checks alternate image orientations and restores joints/directions to the original camera coordinates. Thumb direction remains generally up/down to keep the two volume commands distinct. Brief tracking gaps (up to 180ms) do not restart a stable hold; a hold still needs at least four positive observations. Fully occluded fingers or gestures that are indistinguishable to the camera cannot be guaranteed. The emojis are illustrations, not pose templates.

First use opens a six-pose live practice. Only the expected pose advances the step; practicing poses never sends playback commands. Starting practice in Display 1 pauses the synchronized movie before the card opens and leaves it paused afterward. Completion is remembered locally, with Practice again available. The player exposes its ON/OFF switch directly, with camera and practice options in the adjacent gear menu. Closing practice with X or Escape turns gestures off and releases the camera, without automatically resuming playback. Cancelling, switching off, changing mode/ownership, camera loss or errors release camera tracks and terminate the worker. Hiding/closing a tab releases its camera without clearing the ON setting, so a visible, authorized Display 1/dashboard tab can take over. Web Locks ensure one camera owner. Handoff keeps the lock until any pending permission request has finished and its late stream is stopped; camera changes also wait for previous startup work and require ownership. Turning OFF from either tab stops both. Stored intent is scoped to the room and browser device, renews only while active, and expires two minutes after the last active owner. Different sites/ports, browser profiles, guest displays and other laptops do not inherit consent.

MediaPipe Tasks Vision 1.2.0 and its official gesture model are served locally. CPU inference runs in a dedicated worker, with one frame in flight at a time, at up to 10 frames per second. No camera frames are uploaded or recorded. WebAssembly compilation is allowed only on the recognition worker's response policy. See public/vendor/mediapipe/README.md for sources, license and model hash.

Verification: `node --test tests/hand-controls.test.js tests/hand-tabs.test.js tests/hand-poses.test.js tests/audio-source.test.js`. Tests cover finger bend/spacing and 3D rotations, mirrored hands, thumb direction, conflicting hands, held-pose repeat prevention and brief dropouts, first-use matching, cancellation, camera races/switching, admin↔player handoff, expiry/room isolation, exclusive ownership and both pages' synchronized playback routing. Recognition also needs an actual-camera tryout for lighting, hand positions and each device's performance.
