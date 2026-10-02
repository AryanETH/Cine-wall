# Railway and large local movies

## Deploy this version

Use `outputs/triple-screen-cinema` as the Railway service root if deploying the parent repository, or the repository root if it contains this directory's files directly. Use the included Dockerfile and railway.toml. If Railway does not detect nested config, set the config-file path to this directory's railway.toml in the service settings. The container installs FFmpeg, FFprobe and yt-dlp, starts `node server.js`, and listens on Railway's `PORT`. Use **one replica**; room state and signaling are not shared between instances. Keep the configured custom domain `watch.aitoyz.in` attached to this service.

Redeploy the changed files, then reload the dashboard. This source change does not update an already deployed Railway build by itself. Docker deployment has not been run from this Windows workspace. Railway documents its [config settings](https://docs.railway.com/config-as-code/reference) and [public networking](https://docs.railway.com/networking/public-networking).

`CINEWALL_HOSTED=1` is set in the Dockerfile. Public API requests require a private room identifier even if the reverse proxy supplies an internal host. A public page generates a random room and carries it through navigation, API calls, media URLs, downloads and display links. Every display shares the dashboard's room, for example:

`https://watch.aitoyz.in/screen.html?screen=2&room=<private-room-id>`

All numbered links use the page's public origin, never the server's private IP or internal port. Different rooms have separate playback, files, speakers, presentation pages and peer signaling. A room link is a shared access key, not a login: anyone holding it can join/control that session. Share it only with intended participants. This is not a full public-service security audit or an authenticated multi-tenant service.

## Direct local file — default for video/audio

The dashboard opens the selected file as a browser-local URL immediately. Only filename, size, type, a quick matching-file fingerprint, and playback state go to Railway. On HTTPS, displays request original movie/audio bytes from the source tab over a reliable WebRTC data channel. A service worker serves seekable ranges to the native player. Reads are bounded to 256 KiB, split into 16 KiB packets with backpressure; a 12 GB source is not loaded wholesale into JavaScript memory or uploaded before Play.

Keep the source dashboard open and prevent laptop sleep. Refreshing/closing it loses its browser file access; choose the file again. Use current Chrome/Edge on every laptop. Playback still depends on disk speed, network bandwidth, browser decoding and buffering. Original bytes mean no re-encoding or image-quality loss, not universally instant playback for every format/network.

Service workers need a secure context: HTTPS or localhost, not an ordinary remote `http://192.168...` page. See the [browser requirements](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API). For remote HTTP/LAN displays, choose the **same original file** when prompted. That display uses its own disk immediately while controls remain synchronized; no upload is needed. Matching checks file size and the first/last 64 KiB, not a full-file cryptographic identity check. The admin's separate display tab can reuse the source browser's local file URL.

## Reliable peer connectivity

STUN is configured by default. For different networks or restrictive NAT/firewalls, provide a TURN service through the `CINEWALL_ICE_SERVERS` Railway variable, as JSON:

```json
[
  { "urls": "stun:stun.example.com:3478" },
  { "urls": ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349?transport=tcp"], "username": "your-user", "credential": "your-credential" }
]
```

Replace these example addresses/credentials with an actual service. ICE configuration is delivered to session browsers; use limited-lifetime credentials and configure quotas on your provider for a public launch. TURN relays encrypted traffic and incurs bandwidth costs; it is not movie storage. Without a usable relay, direct connectivity is not guaranteed. Selecting the same local file on each display remains a network-independent media fallback. WebRTC buffering is bounded using [data-channel backpressure](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/bufferedAmountLowThreshold).

## MKV and the optional compatibility copy

MKV is a container. Direct mode does not convert it. If its tracks/container cannot be decoded in the browser, use a compatible original or select **Server compatibility copy**. Supported tracks are remuxed to MP4 using stream copy: every compressed audio/video packet is preserved. That still reads/writes the file and can take time for 12 GB. Other codecs require explicitly permitted lossy re-encoding; without consent CineWall reports the limitation instead of silently reducing quality.

The compatibility-copy option, document uploads and YouTube downloads do use server files, unlike direct local video/audio. The Docker cache is temporary at `/tmp/cinewall-cache`, not a database; a deploy/restart may remove it. Large server uploads remain constrained by hosting limits; Railway documents a five-minute maximum body-upload time in its [networking limits](https://docs.railway.com/networking/public-networking/specs-and-limits). Direct mode avoids sending the movie through that upload path. Office fallback previews remain simplified when a desktop Office converter is unavailable; export to PDF for best fidelity.

## Controls and preview

The dashboard reacts to play/pause/seek and audio changes immediately, coalesces queued seek/volume updates, preserves sliders while dragging, and reconciles with server state. Screen 1 also responds locally before the shared command returns. Shared commands have a short synchronization lead; network delay and independent decoders still prevent a frame-perfect guarantee. The muted dashboard video preview stops at ten seconds and can be replayed independently; it never plays the complete movie or acts as an extra wall display.

## Verification

Run `node --test tests/*.test.js` and `node tests/preparation-integration.js`. Tests cover hosted room separation, domain links, targeted signaling, virtual 12 GB range handling, byte-exact transfer, cancellation, control reconciliation, the ten-second preview, compressed-packet-identical MKV remuxing and explicit conversion consent. No cross-laptop browser/WebRTC or Railway deployment verification was performed in this workspace.
