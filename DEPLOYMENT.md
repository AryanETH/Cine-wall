# CineWall deployment

CineWall uses a long-running Node.js process, in-memory room state, Server-Sent Events and optional local media storage. Use the included Dockerfile and railway.toml for the existing Railway service. Detailed setup and current transport behavior are in [HOSTING.md](HOSTING.md).

## Existing Railway setup

- Select this CineWall directory as the service root.
- Build with the included Dockerfile; start with node server.js.
- Use one replica. Playback state, source ownership and signaling are not shared across instances.
- Keep watch.aitoyz.in attached to this service.
- Redeploy after changing local source files, then reload dashboards and numbered players.

The Docker image includes Node.js 24, FFmpeg, FFprobe and yt-dlp. It sets CINEWALL_HOSTED=1 and CINEWALL_CACHE_DIR=/tmp/cinewall-cache. Temporary cache files can be lost during redeployment. Attach persistent storage and change the cache path if uploaded files must survive it.

## Configuration read by the server

| Variable | Purpose |
| --- | --- |
| PORT | Listening port supplied by the host; defaults to 4173 locally |
| CINEWALL_HOSTED | Set to 1 to require room identifiers for public APIs |
| CINEWALL_CACHE_DIR | Media, preparation and session-cache directory |
| CINEWALL_TLS_CERT / CINEWALL_TLS_KEY | Both trusted certificate and key paths, for local HTTPS |
| CINEWALL_ICE_SERVERS | Optional ICE configuration for legacy peer transport; hosted Instant remains local-only |

The server binds to all interfaces. It does not read a HOST variable. A conventional serverless function is not a drop-in deployment target for this architecture: room state and long-lived signaling would need a different design.

## Local use and verification

Run START CINEMA.cmd or node server.js. Devices join the printed address and numbered room links. Plain HTTP/LAN supports local file-range forwarding; phone microphone access requires trusted HTTPS. On the public website, Instant transfers stay between browsers on the same local network. Upload mode and YouTube downloads use the hosting server's storage and bandwidth.

Before deployment, run npm run check and npm test. Browser testing should include song changes, final-song replay, sound permissions and WebRTC connectivity on the devices and network you intend to use. Passing local tests does not deploy the website.
