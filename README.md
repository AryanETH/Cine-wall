# CineWall Studio

CineWall connects Windows Devices on the same local network for four synchronized modes:

- **Video wall:** 2 or 3 displays, with the admin Device as Display 1.
- **Speaker room:** 1 to 5 Devices, with individual volume and mute controls.
- **Presentation wall:** 1 to 3 displays for PDF, PowerPoint, Word, RTF, and image files.
- **YouTube wall:** 2 or 3 displays showing complementary slices of one synchronized YouTube player.

Run on a local network or deploy on Railway at `https://watch.aitoyz.in`. On HTTPS, the original video/audio stays in the admin browser and only requested byte ranges are shared with displays. On HTTP/LAN, CineWall transfers the single selected file to the local server for all displays. See [HOSTING.md](HOSTING.md) for private session links and deployment.

## Video tutorial

[![Watch the CineWall tutorial on YouTube](https://img.youtube.com/vi/nKjiv6_XSN4/hqdefault.jpg)](https://www.youtube.com/watch?v=nKjiv6_XSN4)

[Watch the tutorial on YouTube](https://www.youtube.com/watch?v=nKjiv6_XSN4). You can also use **Tutorial** on any dashboard.

## Start CineWall

1. Extract the ZIP completely.
2. Double-click **START CINEMA.cmd** and keep the black window open.
3. If Windows Firewall asks, allow Node.js on **Private networks**.
4. Open the **Start** address printed in the black window, normally `http://localhost:4173/`.
5. Choose Video, Audio, Presentation, or YouTube.
6. Add only the Devices you need with **Add display** or **Add speaker**. Use the X on the last-added link to remove it.
7. Open every generated link on its matching Device. Numbered links join automatically. Click the sound button if the browser blocks audio; use Join for fullscreen. Display 1 is always the admin Device.

If port 4173 is busy, CineWall automatically chooses the next free port. Always use the addresses printed by the currently-running server.

## Video wall

1. Start with the two preset links; add the third only when needed.
2. Choose the movie once on the dashboard.
   CineWall checks the container, tracks and browser playback before accepting it. MP4/M4V supports H.264, VP9 and AV1 video with AAC audio; WebM supports VP8/VP9 with Opus audio. MKV supports H.264 video with AAC audio (including HE-AAC and multiple language tracks). The current browser must also decode a frame before sharing starts. Unsupported tracks, including HEVC/Dolby MKV, are rejected with an H.264/AAC MP4 suggestion; CineWall does not convert movies.
   **Instant** starts sharing the selected original file without waiting for a full upload. Keep the source dashboard open; laptops request small byte ranges through it. **Server** uploads a full copy, with progress shown on the dashboard. Neither option converts the movie. The silent preview plays only the opening ten seconds.
3. **Stretch** is the default wall framing. Fit and Cinema crop remain available.
4. Selecting a file opens Display 1 in a separate tab (if your browser allows it); otherwise use **Open Display 1**. Play is enabled only after every selected display reports the current file ready. Play does not reload an already-open display. A browser may still need a click on each laptop to enable sound.
5. Play, pause, seek, double-click ±10 seconds, and per-Device audio changes synchronize across the wall.

Sharing preserves the original bytes. Every Device still needs a browser that supports the selected tracks. DRM streaming services such as Netflix and Prime Video are not supported.

Laptops opening the same local CineWall server share its hotspot room. The first laptop to select a file becomes admin; other laptops see **Open screen** instead of source controls until that admin removes the file. On a public website, share the admin's numbered display links to join the same room. Being on the same Wi-Fi alone does not identify a room online. Display percentages describe startup readiness, not a complete movie download on each device.

## YouTube downloads

On the **Video** dashboard, choose the **YouTube** tab beside **Local video** in Admin Source. This opens the downloader without switching to live YouTube streaming. Paste a link, choose **Find qualities**, then select a format and quality. The menu lists the qualities available for that video, including MP4 and WebM video, MP3 at 96–320 kbps, original M4A audio, and WAV. MP3 bitrates are output settings and do not improve the source audio quality.

Use the X beside a loaded video or audio file to remove it from the session and stop playback on joined Devices. Original files and separately saved downloads are not deleted. Return to **Local video** to upload a file again.

Choose **Download** and wait for it to finish. **Save file** saves it to the browser's Downloads folder. **Use on video wall** loads a supported MP4 into CineWall without conversion. Progress and Cancel are available. Downloads are limited to 10 GB and one active download at a time.

MP3 downloads prefer the AAC audio source and retry other available streams if YouTube refuses that source. Connection errors try an alternate official API route and IPv6, with bounded retries at the selected quality.

The tools are installed in this copy's `tools` folder. For another admin Device, double-click **SETUP DOWNLOADS.cmd** once; run it again to update yt-dlp. The script downloads yt-dlp and FFmpeg from their official GitHub releases, verifies their SHA-256 checksums, and does not change system PATH. For recent YouTube compatibility fixes, use `powershell -NoProfile -ExecutionPolicy Bypass -File setup-download-tools.ps1 -Update -Channel nightly`. The downloader writes its cache inside `.cinema-cache/yt-dlp-cache`. Windows `10013` means the connection was blocked; check firewall/network access if all routes fail. Only download videos you own or have permission to save; restricted videos, sign-in gates and rate limits can still prevent downloads.

## Speaker room

1. Start with Speaker 1 on the admin Device and add up to four more speakers.
2. Choose an audio file once. It uses the same HTTPS/HTTP sharing rules as video.
3. Pressing Play opens Speaker 1 in a separate tab. Each Device must click the join button once so the browser can allow sound.
4. Use the dashboard mixer to control volume or mute for any Device.

MP3, WAV, AAC, M4A, OGG, FLAC, and browser-supported WebM audio are accepted. **All speakers** uses a shared start time and gentle drift correction. Closely-spaced speakers can still echo because their output delays differ; choose **One speaker** to avoid overlapping sound. New video sessions use one speaker by default, while audio sessions use all speakers. Existing saved mixer settings are preserved.

## Presentation wall

1. Start with one display and add up to three.
2. Choose a PDF, PowerPoint, Word, RTF, or image file.
3. For a true horizontal split, use **Fill width**. CineWall renders one wide document canvas and gives every Device a different slice without distorting the page.
4. **Fit page** preserves the complete page; very tall pages may use only the centre portion of a wide multi-display wall.
5. Change pages from the dashboard or Display 1. Every joined display changes at the same synchronized moment.

PDF rendering uses the bundled Mozilla PDF.js runtime and works over the local network. Modern Office documents are prepared locally; Microsoft Office is used for the highest-fidelity conversion when it is available, with a simplified local fallback for supported modern formats.

## YouTube wall

1. Start with two display links; add the third only when needed.
2. Paste a standard YouTube, `youtu.be`, Shorts, Live, or embed link on the dashboard.
3. Open every numbered display link and click **Enter fullscreen & join** once. Use Chrome or Edge for playback.
4. Press Play from the dashboard. Display 1 opens separately and all joined displays follow the admin timeline.
5. Use **Cinema crop** to fill the wall or **Fit** to preserve the complete 16:9 frame. Stretch is intentionally unavailable.
6. YouTube audio plays on Display 1 by default. Choose **All screens** or adjust individual Device volume in the mixer.

YouTube playback requires internet access on every Device. All displays use the official YouTube IFrame Player API with autoplay permission and referrer identification. Dashboard readiness, buffering, errors, and position come from actual player events. Private, removed, age-restricted, or embedding-disabled videos may not play. Because each Device uses an independent YouTube player and buffer, CineWall corrects visible drift but cannot promise frame-perfect synchronization.

## Support this project

Use **Support this project** on the start page, enter an amount, and choose **Generate payment QR**. The QR opens a UPI payment to `6260976807-3@ybl`; payment is completed in the user's UPI app. CineWall does not collect banking details. QR generation uses the external `api.qrserver.com` image service and therefore needs internet access.

## Best results

- Connect every Device to the same normal Wi-Fi or to the admin Device's Mobile Hotspot.
- Use Ethernet or strong 5/6 GHz Wi-Fi when possible.
- Plug Devices into power and disable sleep, screen savers, and battery-saving mode.
- Match display resolution, Windows scaling, brightness, and colour settings.
- Keep the server window open for the entire session.

## Troubleshooting

- **A link times out:** confirm all Devices are on the same non-guest network and Node.js is allowed through Windows Firewall on private networks.
- **The address changed:** use the exact links shown in the active dashboard. Do not reuse links from an older server window.
- **A file does not play:** use MP4 with H.264/AAC or MP3/WAV audio. Convert unsupported movies outside CineWall first.
- **Direct sharing cannot connect:** keep the admin dashboard open and configure TURN for restrictive networks. Choose the file again after refreshing the source dashboard.
- **Sound is blocked:** click the join/allow-sound button once on that Device.
- **The admin plays but other Devices do not:** reload their numbered display links in Chrome or Edge. Confirm each appears on the dashboard's live map. For three Devices, add Display 3 first. A joined display follows the admin automatically; if sound is blocked, local video starts muted and shows an enable-sound button.
- **YouTube stays black or reports an error:** use current Chrome or Edge, confirm internet access on that Device, and try a public video that permits embedding.
- **A display is in the wrong position:** reopen its exact numbered link.
- **An Office file looks simplified:** export it to PDF first, then present the PDF for the most faithful result.

## Stop CineWall

Return to the black server window and press `Ctrl+C`.

## Third-party component

The local PDF renderer is Mozilla PDF.js, licensed under Apache-2.0. Its license is included at `public/vendor/pdfjs/LICENSE`.
YouTube downloads use [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [FFmpeg](https://github.com/yt-dlp/FFmpeg-Builds). Their binaries and bundled license files are kept in the local `tools` folder, which is excluded from Git.
