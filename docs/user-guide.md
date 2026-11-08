# CineWall user guide

[Try CineWall](https://watch.aitoyz.in/) · [Video walkthrough](https://www.youtube.com/watch?v=nKjiv6_XSN4) · [Back to the README](../README.md)

## Set up a room

Start on the laptop that has the file or screen you want to share. Sign in with a verified email, choose a tool, and copy its device links. Open each numbered link on the matching laptop. In Video and Audio, open the first screen or speaker on the source laptop in its own player tab. The source dashboard controls the room, so keep it open. To try another mode from the same workspace, use the mode switch and copy the links for that mode.

## Video and Audio

- **Video wall.** Put two or three laptops side by side and match their screen heights, brightness, and scaling where possible. Choose Fit, Crop, or Stretch. Optional 3D View uses red/cyan glasses.
- **Playback.** Wait until every selected screen reports ready. Use the dashboard to play, pause, seek, and adjust individual speaker volume. If a player is muted by the browser, use **Enable sound** on that device.
- **Music.** Add up to ten songs in Audio and drag them into order. The source dashboard holds the queue and prepares the next song. 3D Sound places speakers across the recording’s left and right stereo channels. Normal plays the full sound on each laptop.
- **Hand gestures.** Turn them on from the video player and complete the on-screen practice. A camera and HTTPS or localhost are required.

### Instant or Server

| Option | How it works | When to use it |
| --- | --- | --- |
| Instant | Media travels directly between devices. The website coordinates playback. | Use it on a network that lets the laptops reach each other. Keep the source tab open. |
| Server | The source uploads the file to the CineWall server. Other devices stream from that server. | Try it if local connections are blocked. Available storage and upload speed affect it. |

### Supported files

Start with H.264 video and AAC audio in MP4. Supported codecs vary by browser. Some WebM and MKV files work, depending on their tracks. Audio supports common formats such as MP3, WAV, AAC, M4A, OGG, and FLAC when the browser can decode them. CineWall does not convert unsupported movies or play DRM-protected streaming services.

The Video and Audio dashboards also have a YouTube download option when the required tools are available. See [requirements and troubleshooting](youtube-downloads.md). Only save content you own or have permission to download.

## Screen sharing and Room Call

1. On the presenter laptop, open Screen sharing in desktop Chrome or Edge. Choose a browser tab, app window, or desktop in the browser’s capture picker.
2. Add receiver screens and copy a different numbered link for each. The full view is mirrored to each receiver.
3. For sound, pick a source with audio, enable **Share audio** in the browser if available, and tap **Enable sound** on the receiver.

Use **Auto** quality first. Each viewer adds network and encoding work for the presenter. The optional Room Call supports up to four devices, starts with mic and camera off, and can stay open when screen sharing stops. The shared pointer is an annotation inside CineWall.

## Mic and Speaker

Open the phone link in portrait mode and open a different speaker link on each laptop. Tap **Enable speaker** on the laptops, then turn on the mic on the phone. Use headphones or move the phone away from speakers if you hear feedback. See [Connection & HTTPS help](https://watch.aitoyz.in/mic-setup.html) for local microphone setup. The phone tools include mic boost, audio-file playback, a scrolling teleprompter, and a voice recorder.

## Troubleshooting

| Problem | Try this |
| --- | --- |
| A device opens a different room | Copy a fresh device link from the current dashboard. A local `localhost` URL only works on the device running CineWall. |
| Instant cannot connect | Use the same Wi-Fi, check local-network permissions, avoid guest networks with device isolation, or try Server. |
| Play is unavailable | Open all the selected screens and wait for them to report ready for the current file. |
| A movie is rejected | Try an H.264/AAC MP4. The file extension alone does not tell you which codecs are inside. |
| Playback drifts | Keep the source laptop awake and powered, reduce other network activity, and try fewer devices. |
| Mic or capture is unavailable | Use HTTPS, grant permission in the browser, and use a supported desktop browser for screen capture. |

For server configuration, see [Hosting](../HOSTING.md) and [Firebase setup](../FIREBASE.md).
