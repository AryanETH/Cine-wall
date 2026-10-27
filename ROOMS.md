# Link sharing and responsive controls

Choose a mode on the homepage to open its workspace. CineWall creates a private session automatically; there is no code-entry screen or room toolbar. Copy the numbered screen or speaker links from the dashboard and open a different link on each laptop. For Mic and Speaker, use the phone link on the phone and the laptop links on speakers. Only share device links with intended participants.

The source browser retains its membership locally. Reloading its dashboard URL resumes admin access without creating another session. Opening a mode from the homepage starts a separate workspace. The dashboard's Share screen shortcut also opens a separate workspace in its new tab. The previous Create/Join, code Copy, Mode, More and recovery-key controls are removed. The server retains its room identity and membership checks behind the links, including compatibility for existing session URLs and internal API clients.

Video and Audio reserve Display/Speaker 1 for the creator. Screen sharing supports ten assigned receivers and Mic and Speaker supports one phone plus three speakers. Admins manage layout and sources; guests can change their own sound. Removing a receiver revokes its membership. Reopening a shared link can obtain an available slot. Shared links never contain the host's membership ticket.

Sessions expire after 24 hours of inactivity. Membership and ownership persist in the configured cache directory, so preserving that directory preserves sessions across server restarts. Ephemeral hosted storage can be lost on redeployment. All participants must use links from the same server. Phone capture still requires trusted HTTPS. Losing the source browser's saved access requires starting a new workspace; recovery is no longer offered in the UI.

Player controls update their visible state immediately. Player mute/unmute also changes the local output before waiting for the server. Pending sound changes survive stale events, and separate speaker controls do not wait behind playback requests. Play uses a short common start scheduled 120 ms ahead to coordinate devices; mute, volume, pause and seek no longer receive an artificial server delay. Network latency, browser sound permissions and device output latency still apply. The dashboard keeps focus when Play is pressed.

## Server safeguards

- Public pages and `/api/health` do not allocate rooms. Unknown UUIDs do not create sessions.
- Creation is limited to 12 attempts per client address per hour; joining, resuming and recovery have separate 30-attempt-per-minute limits. The server permits 64 issued rooms.
- Member identity or an issued room ticket authenticates requests. Movie/audio event peers are bound to their device; a different device cannot replace a stream or send messages as that peer. Readiness reports are restricted to the assigned numbered player.
- One physical page shares one movie/audio EventSource connection between the player/dashboard and file transport.
- `CINEWALL_CACHE_LIMIT_GB` sets the aggregate cache budget in GiB (default 100). Uploads and download/copy operations reserve capacity before writing. Download intermediates are included in reservations and checked periodically. Insufficient free space rejects work rather than accepting another large copy.
- Inactive rooms and their cached copies expire after 24 hours. Ready downloads expire after 24 hours without access; error/cancelled download directories expire after five minutes. Active jobs and downloads being read are protected. Original files on the user's laptop are unaffected.
- The unfinished server-side Office/presentation preparation route is disabled. Use Screen sharing for slides/documents. The remaining fallback parser also has input, entry and expansion limits as defense in depth.
- Root APIs without an issued room are disabled by default. `CINEWALL_LEGACY_LOCAL=1` exists for explicit legacy LAN compatibility and transport fixtures; hosted mode never enables that bypass.

Proxy-header trust is disabled by default, including for caller-supplied edge markers. Behind a trusted proxy that appends a verified address to `X-Forwarded-For`, an administrator can set `CINEWALL_TRUST_PROXY=1`. If traffic can reach the service only through a trusted ingress that overwrites `X-Real-IP`, use the explicit `CINEWALL_TRUST_PROXY=real-ip` mode instead. Railway documents `X-Real-IP` as its client-address header in its [public networking specification](https://docs.railway.com/networking/public-networking/specs-and-limits); enable this mode only after ensuring private callers are trusted and no public TCP proxy bypasses that HTTP edge. Without an explicit setting, limits use the immediate connecting address. Railway also limits request-body uploads to five minutes; use Instant for very large hosted files rather than relying on the application's longer local upload timeout.

## Verification

Run `npm run check`, `npm test`, and `npm run test:preparation` (the last needs FFmpeg). Syntax checks discover all first-party JavaScript entry points. New tests cover short IDs, independent slots and roles, unknown-room floods, impersonation and readiness rejection, receiver removal, persistence, expiry, recovery, quotas, immediate mute/unmute, stale events and independent control queues. Browser checks should include separate origins/devices and real media transfer, not only an admin and player sharing browser storage.
