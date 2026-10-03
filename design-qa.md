# CineWall Studio — Design QA

## Reference set

- `C:\Users\anilp\AppData\Local\Temp\codex-clipboard-fd89641c-0356-4497-9369-926578fcea7e.png`
- `C:\Users\anilp\AppData\Local\Temp\codex-clipboard-a0a43036-53b9-4164-abef-d2880b6a9271.png`
- `C:\Users\anilp\AppData\Local\Temp\codex-clipboard-6ce907b9-20cd-4d33-8ce3-2aa74281868d.png`
- `C:\Users\anilp\AppData\Local\Temp\codex-clipboard-1a44dc0d-0a49-45a9-b452-b82009b79ced.png`

## Implementation captures reviewed

- Mode launcher, light default and dark toggle: `http://localhost:4173/`
- YouTube control room: `http://localhost:4173/admin.html?mode=youtube`
- YouTube Display 1: `http://localhost:4173/screen.html?screen=1`
- YouTube Display 2: `http://localhost:4173/screen.html?screen=2`

The uploaded yellow-to-green halftone artwork and the live launcher were opened side by side. The launcher was reviewed in both themes, and the YouTube dashboard plus two simultaneous display routes were inspected in the Codex in-app browser.

## Comparison and interaction report

- Light is the fresh-install default and uses the requested blue, black, and white palette. The theme toggle persists an explicit user choice.
- Landing cards now show only their mode-specific artwork with no colour or gradient overlay. On pointer hover/focus, the artwork scales by 4% with a restrained opacity lift.
- YouTube appears as a fourth mode with source entry, static thumbnail preview, display links, two framing options, synchronized transport controls, and admin-only/all-screen audio selection.
- Dashboard playback remains silent and does not create a second YouTube player. Play and expand open Display 1 separately.
- Structural wall QA confirmed that a two-display YouTube wall renders one 3,072-pixel-wide player: Display 1 clips the first 1,536 pixels and Display 2 clips the second 1,536 pixels. Fit and Cinema crop both update the shared canvas; Stretch is unavailable.
- Watch, `youtu.be`, and Shorts URL parsing passed; an unrelated domain was rejected with a clear error.
- The prior compatibility embed incorrectly inferred playing state from its own clock; that was not proof of remote playback. It has been removed. All displays now use actual IFrame API player events, explicit autoplay delegation, and referrer identification.
- Numbered links autojoin; local media retries muted when sound autoplay is blocked. Five regression tests pass for all three positions, restoring Display 3, stale commands, server restart recovery, truthful YouTube error status, and download quality selection.
- Live local-video verification confirmed Display 1 and Display 2 playing the same Big Buck Bunny MP4 with advancing positions and no error. Display 1 reports build `2026.10.01-playback-5`; Display 2's older tab still needs reloading for the YouTube changes. Display 3 was not connected at the time of this check. No claim of live three-Device or YouTube embed verification is made.
- Real downloader integration passed: available formats, MP4 download, MP3 conversion, file download headers, loading an MP4 on the wall, and byte-range seeking. An incompatible MPEG-4/MKV fixture was also uploaded and verified as converted H.264/AAC MP4.
- Remote displays keep playing through temporary live-event interruptions, recover the authoritative state through two-second status polling, and delay the blocking offline message for ten seconds.
- The display HUD is hidden so playback contains no CineWall, theme, display-position, or live-status labels.
- The launcher includes an accessible support dialog that validates an amount, generates an amount-specific UPI QR for `6260976807-3@ybl`, links to installed UPI apps, and allows the amount to be changed without closing the dialog.
- Light mode now uses white player, settings, display-link, presentation-preview, and dialog surfaces instead of retaining dark dashboard canvases.
- Accessibility review passed for named icon buttons, labelled sliders, focus-visible styling, disabled states, error announcements, and readable contrast in both themes.
- Responsive review passed for the four-card launcher, YouTube source form, display links, mixer controls, player deck, and narrow dashboard layout.

final result: passed
