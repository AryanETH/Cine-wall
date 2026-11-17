# CineWall security review

Reviewed on 17 November 2026. The review covered the website's account and room permissions, uploads, streaming connections, ads administration, and deployment configuration. The fixes are in the local checkout.

| Finding | Change |
| --- | --- |
| The ads dashboard accepted a four digit password that was documented in the repository. | The default is gone. Staff sign-in requires a private six-digit PIN. Attempts remain rate limited and the Windows launcher hides the PIN at the prompt. |
| A forwarded host could influence which origin the server accepted for a write. | Sign-in, logout, and authenticated writes check the full origin against the original host and scheme. Hosted account cookies use the host-bound HTTPS prefix. |
| Saved device keys and room tickets could confer the previous account's permissions on a shared browser. | Room members are bound to their verified Firebase account. Older rooms bind after the original browser proves its device key. Recovery rotates the key and keeps the room ID. |
| Streams could keep running after a member lost access. Slow connections could also accumulate queued events. | Removing a member closes its open reads. Mic and screen sharing streams verify the matching room member. The server limits active connections and closes event streams that cannot keep up. |
| Uploaded video reached native inspection before its container was restricted. | FFprobe opens only the expected local container. Network protocols and external MP4 references are disabled. Probes have time, output, and concurrency limits. Uploads stop on disconnect or inactivity and retain supported media bytes. |
| Pages lacked framing and form restrictions. The Docker process ran as root. | Responses have framing and MIME protections, origin-only referrers, and HSTS on public hosts. The Docker image runs as an unprivileged user and excludes common local secret files. |

## Before deploying

1. Rotate `CINEWALL_ADS_PASSWORD` in the serving host's private environment. Use a random six-digit PIN. The old password appeared in Git history.
2. Keep HTTPS enabled and preserve the browser's original `Host` header at the proxy. Enable forwarded IP trust only for an ingress you control that sets the reported client address. See [Deployment](DEPLOYMENT.md).
3. Grant the Docker process (UID 1000) write access to any persistent CineWall storage you mounted. Use a current patch of a supported Node.js LTS release. [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
4. Reopen older rooms in the original browser with the intended account. Verify sign-in, a guest's numbered link, and ads administration on the host after deploying.

## Verification and remaining work

- The local suite passed 334 of 337 tests, including signed-in requests using temporary Firebase signing keys, account switching, recovery, hosted room flows, and ads playback. The three baseline failures concern landing page stickers and the README tutorial thumbnail.
- The upload integration test passed cancellation, invalid container rejection, range reads, and byte-for-byte preservation of supported MP4 and MKV files.
- The npm audit reported zero known vulnerabilities in the installed production dependency tree. Review bundled browser libraries, FFmpeg, yt-dlp, and the desktop installer separately when releasing.
- CineWall logout revokes its server session and closes its streams. Firebase console revocations can still take effect at the ID token's expiry. Immediate admin revocation requires Firebase's revocation check. [Firebase session management](https://firebase.google.com/docs/auth/admin/manage-sessions)
- The shipped Windows helper has a separate release cycle. Its self-contained .NET 8 runtime is past support. Rebuild it on a supported .NET release and verify it on Windows before publishing a replacement. [Microsoft .NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core)
- Live hosting settings, production Firebase delivery, and playback across two physical laptops remain to be verified.

The review used the current [OWASP Application Security Verification Standard](https://asvs.owasp.org/), [CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), and [file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).
