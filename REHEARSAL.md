# CineWall room, account and demo update

## Design plan

- Medium: existing responsive vanilla HTML/CSS/JS site, native muted video.
- Frame: existing 16:9 demo container, two equal laptop silhouettes with their bezels retained.
- Focal action: Add screen in the full dashboard on the left laptop.
- Beat 0-3 seconds: dashboard recording at left, Waiting for video at right.
- Beat 3-46.5 seconds: original split movie in both screens, on one playback clock.
- Keep: CineWall colours, button styling, cozy background, string lights, sticker interaction and clipping.
- Omit: extra descriptions, native movie controls, unnecessary new navigation.

## Applied reference

Reviewed benjitaylor/skills Stageshow SKILL.md and its craft/motion references: https://github.com/benjitaylor/skills/tree/main/stageshow . Applied stable geometry, one clear action and payoff, real product assets, minimal copy, visible progress/error states, consistent control sizing and reduced-motion stills. The requested three-second setup overrides the reference's suggested loop lengths. This is a native-video revision of the real site, not a React Stageshow kit build; its film/gate tool was not run.

## Implementation

The two fast MP4s are 1280x720, 24 fps, 46.5 seconds, silent, with fast-start metadata. Both show the same three-second dashboard introduction using the original full-viewport capture frames; the remaining movie and laptop geometry are preserved. The existing movie posters remain the reduced-motion/autoplay fallback. Light/dark switching preserves playback position. The laptop mask applies from the first frame. Public assets use range streaming and caching; account data and room APIs are excluded from the landing cache.

Auth uses the approved Firebase public project config. The split auth/profile layout shares the live demo, keeps input controls readable, exposes a retry action on startup failure, and keeps logout/theme selection in Profile. Protected HTML and APIs verify a signed account before room authorization. Error messages are announced and visually distinct; sign-in returns to the original device link.

## Verification (2026-11-04)

- 42 focused checks passed: room creation, saved-room recovery, mode identity, explicit guest links, authorization failures, verified account cookies/logout, range caching and sign-in UI.
- Latest full suite: 295/297 passed. Two unchanged pre-existing sticker tests fail: outdated horizontal-bound expectations and a fixture without an image style object.
- JavaScript syntax and media preparation checks passed.
- Browser: Firebase SDK loaded with no auth console errors; email/signup/SMS forms visible; direct numbered player link redirected to auth with the complete return URL retained.
- Responsive check at 390px: no horizontal overflow; forms stack above the demo.
- Inspected video frames at 0, 1.46, 2.96, 3 and 3.96 seconds. Playback duration and absence of controls verified in browser.
- Confirmed Firebase public configuration authorizes localhost and watch.aitoyz.in. Real Google/SMS/email submissions were not performed.

Screenshots and regression logs are in the local go/outputs folder. Deployment has not been verified. Room records need a persistent disk and a single server replica in production.

## Account artwork follow-up

Login, signup and profile now place all eight stickers along the bottom of the full artwork panel. String lights are removed only from those pages. Background blur is 3px; the vignette covers the entire rounded artwork panel above the demo and stickers. The public landing page, shared animation implementation and player files are unchanged by this follow-up. Dashboard gesture markup, practice dialog, scripts and initialization are removed; player gesture controls are retained. Default sign-in/signup and profile return targets go to the video dashboard; explicit device invitations retain their destination. Auth/gesture/volume checks: 27 passed.

Browser follow-up: confirmed successful restored sign-in lands in the existing video dashboard and Settings has no gesture panel or gesture scripts. Verified no string-light elements, 3px image blur, a full-panel vignette at layer 4 and all eight stickers on the panel bottom. Final artwork screenshot uses an inert login layout fixture to hold the view while signed-in sessions normally redirect; the temporary fixture was removed after capture.
