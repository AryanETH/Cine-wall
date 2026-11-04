'use strict';
(async () => {
  const login = () => location.replace(`/auth.html?next=${encodeURIComponent(location.pathname + location.search)}`);
  try {
    const config = await (await fetch('/api/auth/config', { cache: 'no-store' })).json();
    if (!config.enabled) return login();
    const [appSdk, sdk] = await Promise.all([import('https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js'), import('https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js')]);
    const auth = sdk.getAuth(appSdk.initializeApp(config.config));
    let queue = Promise.resolve();
    sdk.onIdTokenChanged(auth, user => {
      queue = queue.catch(() => {}).then(async () => {
        if (!user) { await fetch('/api/auth/logout', { method: 'POST' }); login(); return; }
        const result = await fetch('/api/auth/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: await user.getIdToken() }) });
        if (!result.ok) login();
      });
    });
    async function check() { try { const state = await (await fetch('/api/auth/session', { cache: 'no-store' })).json(); if (!state.authenticated) login(); } catch {} }
    window.addEventListener('focus', check);
    window.addEventListener('storage', event => { if (event.key === 'cinewall-account-logout') login(); });
    const timer = setInterval(check, 30000);
    window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  } catch { /* The server still rejects unauthenticated requests during outages. */ }
})();
