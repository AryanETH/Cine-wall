# CineWall accounts

Google, email/password and phone SMS OTP use Firebase Authentication. Sign-in is required for dashboards, player screens, rooms and tool APIs. Landing/demo assets remain public. The server verifies RS256 Firebase ID tokens against Google certificates, including project audience, issuer, expiry and authentication time, then issues an opaque, HttpOnly, SameSite=Lax session cookie. Production cookies use Secure. Sessions expire with the ID token and the browser refreshes them through Firebase. Logout revokes the server session and closes its live connections. Room tickets and device ownership remain a separate authorization check, and saved room links stay available after reauthentication. No service-account private key is needed.

CineWall is registered in the approved `fire` project (`gen-lang-client-0086944749`). The public Web configuration is included in `firebase-web-config.json`. Environment variables can override it:

```
CINEWALL_FIREBASE_API_KEY=your-web-api-key
CINEWALL_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
CINEWALL_FIREBASE_PROJECT_ID=your-project
CINEWALL_FIREBASE_APP_ID=your-web-app-id
```

Restart the server after setting them. `/api/auth/config` exposes only these public fields. Never supply service-account credentials or an Admin SDK private key. Incomplete custom configuration keeps all workspaces locked; the public landing page remains available.

At the last console setup (2026-10-31), Google, Email/Password and Phone were enabled. The public Google support email is `aryanx686@gmail.com`, approved by the owner. `watch.aitoyz.in` is authorized and SMS regions are restricted to India. At that setup, the console reported a 10 SMS/day quota for this new project. The project remains on Spark without a billing upgrade. SMS may require billing; do not enable a paid plan without the owner's approval. Use Firebase's fictional test phone numbers for development. Firebase currently documents that localhost is not allowed as a hosted domain for phone auth.

The phone form informs users that Google processes their number, uses visible Firebase reCAPTCHA and a resend cooldown, then verifies the six-digit SMS code. It does not bypass CAPTCHA, SMS quotas, or provider abuse controls. Email signup sends email verification; password recovery uses Firebase's email flow. Firebase handles credentials and persistent sessions; CineWall does not store passwords or OTPs on its server.

Open `/auth.html` to sign in; `/profile.html` contains profile details, logout and the light/dark toggle. Successful sign-in/signup opens the video dashboard by default, including sign-in started from Profile. Explicit protected workspace/device links return to their original destination. The Firebase SDK also refreshes sessions on protected workspaces. Provider-backed sign-in requires real configuration and successful Google/SMS/email tests before it can be considered verified. The Firebase SDK loads on authentication/profile pages and protected workspaces, keeping the public landing page light.

Official references: https://firebase.google.com/docs/web/setup ; https://firebase.google.com/docs/auth/web/google-signin ; https://firebase.google.com/docs/auth/web/password-auth ; https://firebase.google.com/docs/auth/web/phone-auth

Use Node.js 20.19 or newer and run `npm ci` before starting the server. The Dockerfile installs the locked runtime dependency. Tests use an isolated entrypoint with temporary RSA keys; production has no test-token or authentication-disable flag.

## Room recovery

Opening a tool without an explicit room resumes the last host room. If that room returns 404, the browser discards only that stale membership and explicitly creates a new room. A live room retains its ID across mode changes. Authentication errors, denied membership, rate limits and temporary server failures never allocate replacement rooms. Missing explicit host links offer Start new room; receiver links keep their original room and report the error.

Room records must live on a persistent disk (`CINEWALL_ROOM_STORE_DIR`, or the configured Railway volume). Keep one server replica; separate filesystems cannot share room state. An ephemeral deployment reset can delete records; frontend recovery cannot restore a deleted room's device links. Account cookies are held in server memory, so a server restart requires the browser to refresh its Firebase session through the sign-in page.

Signing in requires internet access and a Firebase-authorized hostname. First-time sign-in over an offline hotspot is not supported by this Firebase flow. Provider-backed Google login, password signup/reset and SMS delivery still need a real user acceptance pass; automated tests use temporary signed test identities and mocked provider responses.
