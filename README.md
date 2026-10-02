# CineWall Studio

CineWall connects Windows laptops on the same local network for four synchronized modes:

- **Video wall:** 2 or 3 displays, with the admin laptop as Display 1.
- **Speaker room:** 1 to 5 laptops, with individual volume and mute controls.
- **Presentation wall:** 1 to 3 displays for PDF, PowerPoint, Word, RTF, and image files.
- **YouTube wall:** 2 or 3 displays showing complementary slices of one synchronized YouTube player.

Run on a local network or deploy on Railway at `https://watch.aitoyz.in`. Video/audio default to **Direct local file**: the original stays in the admin browser and only requested byte ranges are shared with displays. No whole-movie upload or media database is needed for this mode. See [HOSTING.md](HOSTING.md) for private session links, browser/network requirements, and deployment.

## Start CineWall

1. Extract the ZIP completely.
2. Double-click **START CINEMA.cmd** and keep the black window open.
3. If Windows Firewall asks, allow Node.js on **Private networks**.
4. Open the **Start** address printed in the black window, normally `http://localhost:4173/`.
5. Choose Video, Audio, Presentation, or YouTube.
6. Add only the laptops you need with **Add display** or **Add speaker**. Use the X on the last-added link to remove it.
7. Open every generated link on its matching laptop. Numbered links join automatically. Click the sound button if the browser blocks audio; use Join for fullscreen. Display 1 is always the admin laptop.

If port 4173 is busy, CineWall automatically chooses the next free port. Always use the addresses printed by the currently-running server.

## Video wall

1. Start with the two preset links; add the third only when needed.
2. Choose the movie once on the dashboard.
   Direct mode opens a silent local preview immediately when the browser supports the file. It plays only the opening ten seconds and stops; **Replay 10s preview** replays that excerpt. The preview never follows the full wall timeline. Keep the source dashboard open. On an HTTP/LAN remote display, select the same file when prompted; HTTPS supports direct peer sharing.
   **Server compatibility copy** is optional. It transfers the file to the running server and checks its tracks. Compatible MKV tracks are repackaged losslessly, with a distinct progress label. Unsupported codecs are rejected unless you explicitly check **Allow lossy conversion**. Cancel and shared preparation progress remain available; a 12 GB copy/remux can still take time.
3. **Stretch** is the default wall framing. Fit and Cinema crop remain available.
4. Pressing Play opens Display 1 in its own browser tab. Join that screen once; the dashboard stays silent and does not act as a playback screen.
5. Play, pause, seek, double-click ±10 seconds, and per-laptop audio changes synchronize across the wall.

Direct mode preserves the original bytes; it does not make unsupported codecs playable. MKV is a container, not a codec, and browser support varies. A lossless remux changes the container without changing compressed tracks; an explicitly allowed compatibility conversion may change resolution/quality. The optional copy/remux tools must be installed on the server. DRM streaming services such as Netflix and Prime Video are not supported.

## YouTube downloads

On the **Video** dashboard, choose the **YouTube** tab beside **Local video** in Admin Source. This opens the downloader without switching to live YouTube streaming. Paste a link, choose **Find qualities**, then select a format and quality. The menu lists the qualities available for that video, including MP4 and WebM video, MP3 at 96–320 kbps, original M4A audio, and WAV. MP3 bitrates are output settings and do not improve the source audio quality.

Use the X beside a loaded video or audio file to remove it from the session and stop playback on joined laptops. Original files and separately saved downloads are not deleted. Return to **Local video** to upload a file again.

Choose **Prepare download** and wait for downloading and conversion to finish. **Save file** saves it to the browser's Downloads folder. **Use on video wall** loads a prepared MP4 directly into CineWall. The original downloaded file remains available while a compatible wall copy is prepared. Progress and Cancel are available during preparation. Downloads are limited to 10 GB and one active download at a time.

After saving a video, **MP3 from saved video** lets you convert its audio locally at 96–320 kbps, without contacting YouTube again. Saved downloads remain available after restarting CineWall. MP3 downloads prefer the AAC audio source and retry other available streams if YouTube refuses that source.

The tools are installed in this copy's `tools` folder. For another admin laptop, double-click **SETUP DOWNLOADS.cmd** once; run it again to update yt-dlp. The script downloads yt-dlp and FFmpeg from their official GitHub releases, verifies their SHA-256 checksums, and does not change system PATH. For recent YouTube compatibility fixes, use `powershell -NoProfile -ExecutionPolicy Bypass -File setup-download-tools.ps1 -Update -Channel nightly`. The downloader writes its cache inside `.cinema-cache/yt-dlp-cache`, not your Windows home folder. Only download videos you own or have permission to save; unavailable or restricted videos return an error. YouTube rate limits or sign-in checks cannot be fixed by changing cache permissions; try later or convert a video already saved locally.

## Speaker room

1. Start with Speaker 1 on the admin laptop and add up to four more speakers.
2. Choose an audio file once. Direct file sharing is the default, with the same HTTPS/HTTP fallback rules as video.
3. Pressing Play opens Speaker 1 in a separate tab. Each laptop must click the join button once so the browser can allow sound.
4. Use the dashboard mixer to control volume or mute for any laptop.

MP3, WAV, AAC, M4A, OGG, FLAC, and browser-supported WebM audio are accepted. Closely-spaced laptop speakers may create an echo.

## Presentation wall

1. Start with one display and add up to three.
2. Choose a PDF, PowerPoint, Word, RTF, or image file.
3. For a true horizontal split, use **Fill width**. CineWall renders one wide document canvas and gives every laptop a different slice without distorting the page.
4. **Fit page** preserves the complete page; very tall pages may use only the centre portion of a wide multi-display wall.
5. Change pages from the dashboard or Display 1. Every joined display changes at the same synchronized moment.

PDF rendering uses the bundled Mozilla PDF.js runtime and works over the local network. Modern Office documents are prepared locally; Microsoft Office is used for the highest-fidelity conversion when it is available, with a simplified local fallback for supported modern formats.

## YouTube wall

1. Start with two display links; add the third only when needed.
2. Paste a standard YouTube, `youtu.be`, Shorts, Live, or embed link on the dashboard.
3. Open every numbered display link and click **Enter fullscreen & join** once. Use Chrome or Edge for playback.
4. Press Play from the dashboard. Display 1 opens separately and all joined displays follow the admin timeline.
5. Use **Cinema crop** to fill the wall or **Fit** to preserve the complete 16:9 frame. Stretch is intentionally unavailable.
6. YouTube audio plays on Display 1 by default. Choose **All screens** or adjust individual laptop volume in the mixer.

YouTube playback requires internet access on every laptop. All displays use the official YouTube IFrame Player API with autoplay permission and referrer identification. Dashboard readiness, buffering, errors, and position come from actual player events. Private, removed, age-restricted, or embedding-disabled videos may not play. Because each laptop uses an independent YouTube player and buffer, CineWall corrects visible drift but cannot promise frame-perfect synchronization.

## Support this project

Use **Support this project** on the start page, enter an amount, and choose **Generate payment QR**. The QR opens a UPI payment to `6260976807-3@ybl`; payment is completed in the user's UPI app. CineWall does not collect banking details. QR generation uses the external `api.qrserver.com` image service and therefore needs internet access.

## Best results

- Connect every laptop to the same normal Wi-Fi or to the admin laptop's Mobile Hotspot.
- Use Ethernet or strong 5/6 GHz Wi-Fi when possible.
- Plug laptops into power and disable sleep, screen savers, and battery-saving mode.
- Match display resolution, Windows scaling, brightness, and colour settings.
- Keep the server window open for the entire session.

## Troubleshooting

- **A link times out:** confirm all laptops are on the same non-guest network and Node.js is allowed through Windows Firewall on private networks.
- **The address changed:** use the exact links shown in the active dashboard. Do not reuse links from an older server window.
- **A file does not play:** try an MP4/H.264/AAC or MP3/WAV source. For MKV, try a lossless compatibility copy first. Lossy re-encoding is opt-in, never automatic.
- **Direct sharing cannot connect:** keep the admin dashboard open, use HTTPS, configure TURN for restrictive networks, or select the matching local file on each laptop. Direct file access must be reselected after refreshing the source dashboard.
- **Sound is blocked:** click the join/allow-sound button once on that laptop.
- **The admin plays but other laptops do not:** reload their numbered display links in Chrome or Edge. Confirm each appears on the dashboard's live map. For three laptops, add Display 3 first. A joined display follows the admin automatically; if sound is blocked, local video starts muted and shows an enable-sound button.
- **YouTube stays black or reports an error:** use current Chrome or Edge, confirm internet access on that laptop, and try a public video that permits embedding.
- **A display is in the wrong position:** reopen its exact numbered link.
- **An Office file looks simplified:** export it to PDF first, then present the PDF for the most faithful result.

## Stop CineWall

Return to the black server window and press `Ctrl+C`.

## Third-party component

The local PDF renderer is Mozilla PDF.js, licensed under Apache-2.0. Its license is included at `public/vendor/pdfjs/LICENSE`.
YouTube downloads use [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [FFmpeg](https://github.com/yt-dlp/FFmpeg-Builds). Their binaries and bundled license files are kept in the local `tools` folder, which is excluded from Git.
