'use strict';

(async () => {
  const home = document.querySelector('#homeAccount');
  const logoutButtons = [...document.querySelectorAll('[data-account-logout]')];
  const logoutErrors = [...document.querySelectorAll('[data-logout-error]')];
  const accountKey = 'cinewall-account-used';
  const logoutKey = 'cinewall-account-logout';
  const login = () => location.replace(`/auth.html?next=${encodeURIComponent(location.pathname + location.search)}`);
  let firebase, signingOut = false, sessionUpdates = Promise.resolve();

  async function loadFirebase() {
    firebase ||= (async () => {
      const response = await fetch('/api/auth/config', { cache: 'no-store' });
      const config = await response.json();
      if (!config.enabled) throw Error('Sign-in is unavailable');
      const [appSdk, sdk] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js'),
      ]);
      return { sdk, auth: sdk.getAuth(appSdk.initializeApp(config.config)) };
    })().catch(error => { firebase = undefined; throw error; });
    return firebase;
  }

  const trigger = home?.querySelector('#accountTrigger');
  const popover = home?.querySelector('#accountPopover');
  const returnUrl = home ? new URL(location.href) : null;
  function showPopover(open, focusTrigger = false) {
    if (!popover) return;
    popover.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (focusTrigger) trigger.focus();
  }
  function showAccount(account) {
    if (!home) return;
    const name = account?.name || 'CineWall account';
    const initials = (account?.name || account?.email || 'C').trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase();
    home.querySelectorAll('[data-account-name]').forEach(node => { node.textContent = name; });
    home.querySelectorAll('[data-account-email]').forEach(node => { node.textContent = account?.email || ''; });
    home.querySelectorAll('[data-account-initials]').forEach(node => { node.textContent = initials; });
    home.querySelector('#accountLink').hidden = Boolean(account);
    trigger.hidden = !account;
    if (!account) showPopover(false);
    else if (returnUrl.searchParams.get('account') === 'open') {
      showPopover(true, true);
      returnUrl.searchParams.delete('account');
      history.replaceState(history.state, '', returnUrl);
    }
  }
  if (home) {
    trigger.addEventListener('click', () => showPopover(popover.hidden));
    home.querySelector('.account-close').addEventListener('click', () => showPopover(false, true));
    document.addEventListener('pointerdown', event => { if (!home.contains(event.target)) showPopover(false); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !popover.hidden) showPopover(false, home.contains(document.activeElement)); });
  }

  async function endSession() {
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    if (!response.ok) throw Error('Could not end session');
  }
  async function logOut() {
    if (signingOut) return;
    signingOut = true;
    logoutButtons.forEach(button => { button.disabled = true; });
    logoutErrors.forEach(error => { error.hidden = true; });
    try {
      const { auth, sdk } = await loadFirebase();
      await auth.authStateReady();
      await sessionUpdates;
      await endSession();
      await sdk.signOut(auth);
      try {
        localStorage.removeItem(accountKey);
        localStorage.setItem(logoutKey, String(Date.now()));
      } catch {}
      location.replace('/auth.html');
    } catch {
      signingOut = false;
      logoutButtons.forEach(button => { button.disabled = false; });
      logoutErrors.forEach(error => { error.hidden = false; });
    }
  }
  logoutButtons.forEach(button => button.addEventListener('click', logOut));

  async function session() {
    const response = await fetch('/api/auth/session', { cache: 'no-store' });
    if (!response.ok) throw Error('Could not read session');
    return response.json();
  }
  function rememberAccount() {
    try { localStorage.setItem(accountKey, '1'); } catch {}
  }
  function hasAccountHint() {
    try { return localStorage.getItem(accountKey) === '1'; } catch { return false; }
  }
  let watching = false;
  async function watchFirebase() {
    if (watching) return;
    watching = true;
    try {
      const { auth, sdk } = await loadFirebase();
      sdk.onIdTokenChanged(auth, user => {
        sessionUpdates = sessionUpdates.then(async () => {
          if (signingOut || auth.currentUser !== user) return;
          if (!user) {
            if (!home) { await endSession(); login(); }
            else showAccount(null);
            return;
          }
          const result = await fetch('/api/auth/session', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken: await user.getIdToken() }),
          });
          if (signingOut) return;
          if (!result.ok) { if (home) showAccount(null); else login(); return; }
          rememberAccount();
          if (home) showAccount((await result.json()).account);
        }).catch(() => {});
      });
    } catch {
      watching = false;
      // Server authorization still applies when the provider is unreachable.
    }
  }
  async function check() {
    if (signingOut) return;
    try {
      const state = await session();
      if (home) {
        showAccount(state.account);
        if (state.authenticated) rememberAccount();
        if (state.authenticated || hasAccountHint()) await watchFirebase();
      } else if (!state.authenticated) login();
    } catch {}
  }

  window.addEventListener('focus', check);
  window.addEventListener('storage', event => {
    if (event.key === logoutKey) { if (home) showAccount(null); else login(); }
    if (home && event.key === accountKey && event.newValue) void check();
  });
  if (home) {
    window.addEventListener('pageshow', event => { if (event.persisted) void check(); });
    await check();
  } else {
    const timer = setInterval(check, 30000);
    window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    await watchFirebase();
  }
})();
