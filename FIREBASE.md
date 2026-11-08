# CineWall accounts

Google, email/password and phone SMS OTP use Firebase Authentication. Sign-in is required for dashboards, player screens, rooms and tool APIs. Landing/demo assets remain public. The server verifies RS256 Firebase ID tokens against Google certificates, including project audience, issuer, expiry and authentication time, then issues an opaque, HttpOnly, SameSite=Lax session cookie. Production cookies use Secure. Sessions expire with the ID token and the browser refreshes them through Firebase. Logout revokes the server session and closes its live connections. Room tickets and device ownership remain a separate authorization check, and saved room links stay available after reauthentication. No service-account private key is needed.

CineWall is registered in the approved `fire` project (`gen-lang-client-0086944749`). The public Web configuration is included in `firebase-web-config.json`. Environment variables can override it:

```
CINEWALL_FIREBASE_API_KEY=your-web-api-key
CINEWALL_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
CINEWALL_FIREBASE_PROJECT_ID=your-project
CINEWALL_FIREBASE_APP_ID=your-web-app-id
```

Restart the server after setting them. `/api/auth/config` exposes these public fields and whether branded verification is enabled. Incomplete custom configuration keeps all workspaces locked; the public landing page remains available.

At the last console setup (2026-10-31), Google, Email/Password and Phone were enabled. The public Google support email is `aryanx686@gmail.com`, approved by the owner. `watch.aitoyz.in` is authorized and SMS regions are restricted to India. At that setup, the console reported a 10 SMS/day quota for this new project. The project remains on Spark without a billing upgrade. SMS may require billing; do not enable a paid plan without the owner's approval. Use Firebase's fictional test phone numbers for development. Firebase currently documents that localhost is not allowed as a hosted domain for phone auth.

The phone form informs users that Google processes their number, uses visible Firebase reCAPTCHA and a resend cooldown, then verifies the six-digit SMS code. It does not bypass CAPTCHA, SMS quotas, or provider abuse controls. Email signup sends email verification; password recovery uses Firebase's email flow. Firebase handles credentials and persistent sessions; CineWall does not store passwords or OTPs on its server.

## Branded verification email

Email signup saves the name to the Firebase profile before requesting verification. Signup and Resend email on the verification screen use the same verification sender. Without custom mail settings they use Firebase's built-in email. Firebase documents that real SMS delivery requires a billing-linked project; leave billing unchanged and use fictional test numbers for development.

To enable the CineWall email, configure these **server-only** settings in your hosting environment:

- `CINEWALL_FIREBASE_MAIL_SERVICE_ACCOUNT`: the JSON credentials for a dedicated service account in the Firebase project with permission to generate Firebase email action links (`firebaseauth.users.sendEmail`). Keep this in the host's secret manager.
- `CINEWALL_RESEND_API_KEY`: a sending key for the verified domain. Disable click tracking for verification messages to preserve the original Firebase link.
- `CINEWALL_VERIFICATION_FROM`: a verified sender, such as `CineWall <verify@your-domain.example>`.

Restart and check that `/api/auth/config` reports `brandedVerification: true`. The server takes the recipient and name from a verified Firebase token and uses Firebase to generate the action link. It sends the HTML email with a plain-text alternative and limits requests to one per recipient per minute and 100 attempts per server per 24 hours. Never put credentials in the repository, in a public config file, or in browser code. When switching providers, verify delivery and the action link with a test account.

Open `/auth.html` to create an account or sign in. The form starts on signup for new browsers and sign-in for returning users. Either screen links to the other. Before opening a workspace or room API, the server requires a Firebase token with a verified email. The verification screen can resend the email and refresh verification after the link is opened. SMS users can link and verify an email from the same screen. Verified sign-ins open the video dashboard by default or return to the original workspace or device link. The landing page shows the profile menu for verified sessions and loads Firebase only to restore or manage an existing account. The profile page contains the theme toggle, and logout is available from the profile menu and dashboard settings.

Official references: https://firebase.google.com/docs/web/setup ; https://firebase.google.com/docs/auth/web/google-signin ; https://firebase.google.com/docs/auth/web/password-auth ; https://firebase.google.com/docs/auth/web/phone-auth

Use Node.js 20.19 or newer and run `npm ci` before starting the server. The Dockerfile installs the locked runtime dependency. Tests use an isolated entrypoint with temporary RSA keys; production has no test-token or authentication-disable flag.

## Room recovery

Opening a tool without an explicit room resumes the last host room. If that room returns 404, the browser discards only that stale membership and explicitly creates a new room. A live room retains its ID across mode changes. Authentication errors, denied membership, rate limits and temporary server failures never allocate replacement rooms. Missing explicit host links offer Start new room; receiver links keep their original room and report the error.

Room records must live on a persistent disk (`CINEWALL_ROOM_STORE_DIR`, or the configured Railway volume). Keep one server replica; separate filesystems cannot share room state. An ephemeral deployment reset can delete records; frontend recovery cannot restore a deleted room's device links. Account cookies are held in server memory, so a server restart requires the browser to refresh its Firebase session through the sign-in page.

Signing in requires internet access and a Firebase-authorized hostname. First-time sign-in over an offline hotspot is not supported by this Firebase flow. Provider-backed Google login, password signup/reset and SMS delivery still need a real user acceptance pass; automated tests use temporary signed test identities and mocked provider responses.
