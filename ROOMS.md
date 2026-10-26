# Rooms and responsive controls

Choose a mode on the homepage, then choose **Create room** or **Join room**. The creator sees a copyable eight-character ID such as `ABCD-EFGH`. Guests choose the same mode, enter the ID, and receive their own numbered display or speaker. Mic and Speaker additionally lets a joining device choose Phone microphone or Laptop speaker. A room ID is private invitation information, so share it with intended participants.

Video and Audio reserve Display/Speaker 1 for the creator. Joining receivers expand the active layout up to the mode's limit. Screen sharing supports ten assigned receivers and Mic and Speaker supports one phone plus three speakers. Admins manage layout and sources; guests can change their own sound. Removing a receiver revokes its membership. A deliberate new join can obtain a new available slot.

The dashboard shows a separate **Admin recovery key**. Save it privately. The homepage's **Lost admin access? Recover your room** flow requires both the room ID and this key, revokes the old administrator's membership, and restores control. The room ID alone cannot transfer ownership. Uploaded media remains available; an in-browser source must be selected again after recovery.

Rooms expire after 24 hours of inactivity. Issued IDs, membership and ownership persist in the configured cache directory, so preserving that directory preserves rooms across server restarts. Ephemeral hosted storage can be lost on redeployment. A code works only on the server that issued it. For local use, every laptop opens the same LAN server address; phone capture still requires trusted HTTPS.

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
