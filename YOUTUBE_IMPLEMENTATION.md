# CineWall YouTube mode

YouTube is a first-class CineWall mode beside local video, audio, and presentation sharing.

## What is implemented

- Watch, `youtu.be`, Shorts, Live, embed, and raw video-ID parsing.
- Official YouTube IFrame Player API integration in numbered display pages only.
- Two- and three-display wall layouts. Each display clips a different horizontal slice from the same combined 16:9 canvas.
- Admin-authoritative play, pause, restart, seek, timeline, fullscreen handoff, volume, mute, and periodic drift correction.
- Display 1 audio by default, optional audio on all displays, and per-Device mixer controls.
- Buffering, player state, duration, current time, title, readiness, reconnect, and understandable embedding/network errors reported to the dashboard.
- A static dashboard thumbnail, so the dashboard does not create a competing playback instance.

## Use

1. Choose **Stream YouTube** on the launcher.
2. Paste a supported YouTube URL and choose **Load video**.
3. Open each numbered display link in Chrome or Edge and click **Enter fullscreen & join** once.
4. Use **Cinema crop** to fill the combined wall or **Fit** to preserve the complete frame.
5. Press Play on the dashboard. Display 1 opens in its own tab and all joined displays follow.

## Constraints

Every display needs internet access. YouTube may refuse private, removed, age-restricted, region-blocked, or embedding-disabled videos. Independent YouTube players can buffer differently, so CineWall periodically corrects drift but cannot provide frame-perfect synchronization. Player status comes from actual IFrame API events; the old clock-only compatibility embed has been removed.

## Video dashboard downloads

The local-video dashboard also offers yt-dlp/FFmpeg downloads. Available video resolutions are read from each video's format list. MP4/WebM video and MP3/M4A/WAV audio are supported. Server-side format tokens prevent arbitrary command arguments. Jobs expose progress, cancellation, a file download, and MP4 loading into the wall. Uploaded and downloaded wall videos are checked and converted/remuxed into H.264/AAC MP4 when needed. No browser cookies or sign-in credentials are requested.

The downloader uses a writable project-local cache and IPv4. Audio conversion prefers AAC/M4A, with bounded retries of alternative available streams on HTTP 403. Completed jobs are restored after restart. The MP3-from-saved-video control converts an existing video locally using FFmpeg and does not make any YouTube request. Rate limiting and sign-in checks are shown as actionable errors, not hidden or treated as filesystem failures.
