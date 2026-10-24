# Railway and large local movies

## Deploy this version

Use `outputs/triple-screen-cinema` as the Railway service root if deploying the parent repository, or the repository root if it contains this directory's files directly. Use the included Dockerfile and railway.toml. If Railway does not detect nested config, set the config-file path to this directory's railway.toml in the service settings. The container installs FFmpeg, FFprobe and yt-dlp, starts `node server.js`, and listens on Railway's `PORT`. Use **one replica**; room state and signaling are not shared between instances. Keep the configured custom domain `watch.aitoyz.in` attached to this service.

Redeploy the changed files, then reload the dashboard. This source change does not update an already deployed Railway build by itself. Docker deployment has not been run from this Windows workspace. Railway documents its [config settings](https://docs.railway.com/config-as-code/reference) and [public networking](https://docs.railway.com/networking/public-networking).

`CINEWALL_HOSTED=1` is set in the Dockerfile. Public API requests require a private room identifier even if the reverse proxy supplies an internal host. A public page generates a random room and carries it through navigation, API calls, media URLs, downloads and display links. Every display shares the dashboard's room, for example:

`https://watch.aitoyz.in/screen.html?screen=2&room=<private-room-id>`

All numbered links use the page's public origin, never the server's private IP or internal port. Different rooms have separate playback, files, speakers, presentation pages and peer signaling. Share the admin's numbered display links for devices joining online; the landing page has no manual room controls. On LAN, the same server address has a common room. A public website cannot reliably identify a private hotspot, so online devices must share a room link. The first source laptop claims the admin role using a per-browser device ID and secret; other laptops see **Open screen** instead of source controls and cannot replace or remove its file until the owner removes it. Room links are not a full login system. Share them only with intended participants. This is not a full public-service security audit or an authenticated multi-tenant service.

## Local video/audio sharing

Before sharing a video, the dashboard checks its container and tracks, then tests whether the current browser decodes a frame. Metadata reads are bounded: MP4 data boxes are skipped even when metadata sits after 12 GB of movie data. Accepted video uses MP4/M4V with H.264, VP9 or AV1 video and AAC audio, WebM with VP8/VP9 and Opus/Vorbis, or MKV with H.264 and AAC (including HE-AAC and multiple language tracks). Metadata validation allows common 8-bit profiles; browser decoding still determines whether each device can play the file. HEVC/Dolby MKV and unsupported tracks remain rejected. CineWall does not convert or remux uploaded movies.

**Instant on the website** publishes metadata, then serves original file ranges directly between browsers on the same Wi-Fi/hotspot through WebRTC. Requests are bounded to 256 KiB and packets to 16 KiB. The service worker exposes seekable ranges to each player. Only private host candidates are allowed; this path does not use STUN or TURN and does not silently upload media to the hosting server. Keep the source dashboard open and the laptop awake. Guest-network isolation and local firewall restrictions can prevent a connection.

**Instant on a local HTTP server** can relay bounded ranges through Node in memory without saving a full movie copy. Only the source selects the file; receivers do not need another copy. **Upload** transfers the entire original file to server storage before playback. These paths preserve the original movie bytes without conversion or remuxing.

Keep the source dashboard open and prevent Device sleep. Refreshing/closing it loses its browser file access; choose the file again. Use current Chrome/Edge on every Device. Playback still depends on disk speed, network bandwidth, browser decoding and buffering. Original bytes mean no re-encoding or image-quality loss, not universally instant playback for every format/network.

Only the source laptop selects a file. Its separate display tab reuses the local file when available, while other devices read ranges. Play is gated on current asset-version readiness, adequate browser data, and no buffering/errors on every selected display. Percentages shown per display represent startup readiness, not a full-file download. The dashboard does not reopen/reload Display 1 when Play is pressed. Browser sound restrictions can still require a click on each device.

## Reliable peer connectivity

Hosted **Instant** uses the local-only WebRTC path described above. Configured ICE servers do not override its private-host-candidate restriction. The following optional ICE configuration is for legacy non-hotspot peer transport; it does not enable an internet fallback for hosted Instant.

STUN is configured by default. For different networks or restrictive NAT/firewalls, provide a TURN service through the `CINEWALL_ICE_SERVERS` Railway variable, as JSON:

```json
[
  { "urls": "stun:stun.example.com:3478" },
  { "urls": ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349?transport=tcp"], "username": "your-user", "credential": "your-credential" }
]
```

Replace these example addresses/credentials with an actual service. ICE configuration is delivered to session browsers; use limited-lifetime credentials and configure quotas on your provider for a public launch. TURN relays encrypted traffic and incurs bandwidth costs; it is not movie storage. Without a usable relay, direct connectivity is not guaranteed. Only the admin selects the file. WebRTC buffering is bounded using [data-channel backpressure](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/bufferedAmountLowThreshold).

## Browser formats and server files

The server also checks uploaded video tracks before publishing them. H.264/AAC MKV is accepted without remuxing or conversion; this includes dual AAC/HE-AAC audio tracks. HEVC/Dolby MKV remains rejected. The admin browser must decode a frame before sharing, and each display still needs a compatible decoder. A rejected file leaves the previous movie and playback state intact. Renaming MKV to `.mp4` (or MP4 to `.mkv`) cannot pass the container check. Decoder/source recovery remains bounded, but does not change the original bytes or create a converted movie. Reload the dashboard and numbered display tabs after an update.

Upload copies, document preparation and YouTube downloads use server files. Local Instant forwarding uses bounded memory ranges instead of saving a full media copy. The Docker cache defaults to temporary storage at `/tmp/cinewall-cache`; redeployment may remove it. Choose persistent storage if these copies must survive a deployment. Hosted Instant avoids full-file uploads, but depends on direct browser connectivity. Dedicated presentation support remains in development; use Screen sharing for a slides or document window.

## Controls and preview

The dashboard reacts to play/pause/seek and audio changes immediately, coalesces queued seek/volume updates, preserves sliders while dragging, and reconciles with server state. Screen 1 also responds locally before the shared command returns. Shared commands have a short synchronization lead; network delay and independent decoders still prevent a frame-perfect guarantee. The muted dashboard video preview stops at ten seconds and can be replayed independently; it never plays the complete movie or acts as an extra wall display.

## YouTube downloader recovery

Both Video and Audio dashboards have a **Local video/audio · YouTube** source selector. Audio mode offers only audio download choices: MP3, raw AAC, M4A (AAC), and WAV. AAC extraction can copy the existing AAC source or convert another available codec; bitrate choices cannot improve the source quality. Ready audio can be saved or loaded directly into the speaker room, with the session's usual synchronized play/pause/seek and per-Device audio controls. Downloads and speaker copies stay scoped to the private room. YouTube downloads still use server storage, unlike direct local-file sharing.

Drop a local MP3/AAC/M4A/WAV/FLAC/OGG/OGA/WebM audio file onto the source panel, including files with uppercase extensions or missing OS MIME information. Dropping a YouTube link switches to the YouTube source and fills the link field; the user explicitly checks formats before downloading. Only download content you own or have permission to save.

Transient stream errors trigger one fresh format inspection, followed by bounded alternate-stream retries at the same selected format/resolution/frame-rate tier. MP3/WAV can use alternate source audio streams while preserving the selected output settings. A vanished quality is reported instead of silently choosing a lower resolution. Cancellation also aborts an in-flight format refresh. Fragment failures are not silently skipped to produce an incomplete video.

Keep yt-dlp and its bundled challenge solver current. Node 24 is supplied in Docker, with `yt-dlp[default]`; the Windows installer can update official tools. Sign-in requirements, rate limits, DRM and required playback authorization are not retried as ordinary transient errors. Some YouTube refusals cannot be solved by an app retry; inspect the exact error and video selection. See the official [yt-dlp documentation](https://github.com/yt-dlp/yt-dlp) and [EJS requirements](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

Connection failures also try the official `youtubei.googleapis.com` API with the embedded client, then IPv6. The successful route is reused for the download. Retries are bounded and never route user links through an unrelated download service. Windows `10013` produces a short firewall/network message when attempts fail; changing API routes cannot guarantee access when Windows blocks the downloader process. The saved-video MP3 conversion UI and endpoints have been removed. YouTube audio extraction remains available in the MP3/AAC/M4A/WAV choices.

## Verification

Run `npm run check` and `npm test`. Tests cover room separation, scoped signaling, large-file ranges, byte-exact transfer, cancellation, playlist progression/replay, 3D audio metering and download retries. Local Chrome browser peers have verified hosted Instant song transitions through real WebRTC channels and service-worker range playback. Railway deployment and physical multi-laptop behavior have not been verified from this workspace.
