'use strict';
(async () => {
  const $ = selector => document.querySelector(selector), status = $('#authStatus');
  const profilePage = document.body?.dataset.authPage === 'profile';
  const dashboard = '/admin.html?mode=video';
  let next = dashboard;
  try {
    const requested = new URL(new URL(location.href).searchParams.get('next') || dashboard, location.origin);
    if (requested.origin === location.origin && /^\/(?:admin|screen|share|mic|room|connect)\.html$/.test(requested.pathname)) next = requested.pathname + requested.search;
  } catch {}
  let busy = false, signup = false, verifier, confirmation, resendAt = 0, pendingDestination;
  $('#authRetry')?.addEventListener('click', () => location.reload());
  const message = (text, error = false) => {
    status.textContent = text;
    status.dataset.state = error ? 'error' : 'status';
    status.setAttribute('role', error ? 'alert' : 'status');
  };
  const errors = {
    'auth/invalid-credential': 'Check your email and password.', 'auth/email-already-in-use': 'An account already uses this email. Sign in or reset your password.',
    'auth/weak-password': 'Choose a stronger password.', 'auth/popup-closed-by-user': 'Google sign-in was closed. Try again.',
    'auth/popup-blocked': 'Allow the Google sign-in popup and try again.', 'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
    'auth/invalid-verification-code': 'That code is incorrect. Try again.', 'auth/code-expired': 'That code expired. Request a new one.',
    'auth/unauthorized-domain': 'Sign-in is not enabled for this website yet.', 'auth/operation-not-allowed': 'This sign-in method has not been enabled yet.',
    'auth/network-request-failed': 'Connection lost. Please try again.', 'auth/quota-exceeded': 'SMS sign-in is temporarily unavailable.',
    'auth/billing-not-enabled': 'SMS sign-in is unavailable. Continue with Google or email.',
  };
  async function run(action) {
    if (busy) return;
    busy = true;
    $('#authForms').setAttribute('aria-busy', 'true');
    document.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try { await action(); } catch (error) { message(errors[error.code] || 'Could not complete sign-in. Please try again.', true); }
    finally { busy = false; $('#authForms').setAttribute('aria-busy', 'false'); document.querySelectorAll('button').forEach(button => { button.disabled = false; }); if (pendingDestination) location.replace(pendingDestination); }
  }
  try {
    const response = await fetch('/api/auth/config', { cache: 'no-store' });
    if (!response.ok) throw new Error('Configuration unavailable');
    const config = await response.json();
    if (!config.enabled) { message('Sign-in is unavailable. Please try again later.', true); $('#authRetry').hidden = false; return; }
    const [appSdk, sdk] = await Promise.all([import('https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js'), import('https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js')]);
    const auth = sdk.getAuth(appSdk.initializeApp(config.config));
    sdk.useDeviceLanguage(auth);
    await sdk.setPersistence(auth, sdk.browserLocalPersistence);
    let accountQueue = Promise.resolve();
    sdk.onIdTokenChanged(auth, user => {
      accountQueue = accountQueue.catch(() => {}).then(async () => {
      if (user) {
        try {
          const session = await fetch('/api/auth/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: await user.getIdToken() }) });
          if (!session.ok) { message('Your sign-in could not be verified. Please try again.'); $('#authForms').hidden = false; $('#accountPanel').hidden = true; return; }
          if (!profilePage) { if (busy) pendingDestination = next; else location.replace(next); return; }
        } catch { message('Could not connect. Please try again.'); return; }
      } else if (profilePage) { location.replace('/auth.html'); return; }
      $('#authForms').hidden = Boolean(user); $('#accountPanel').hidden = !user;
      $('#authTitle').textContent = user ? 'Your profile.' : 'Welcome back.';
      message('');
      if (user) {
        $('#accountIdentity').textContent = user.displayName || user.email || user.phoneNumber;
        $('#profileName').textContent = user.displayName || 'Your profile';
        $('#profileEmail').textContent = user.email || 'Not added';
        $('#profilePhone').textContent = user.phoneNumber || 'Not added';
        $('#profileAvatar').textContent = (user.displayName || user.email || 'C').slice(0, 1).toUpperCase();
        $('#verificationState').textContent = user.email && !user.emailVerified ? 'Email not verified yet.' : '';
        $('#verifyEmail').hidden = !user.email || user.emailVerified;
        try { localStorage.setItem('cinewall-account-used', '1'); } catch {}
      } else { try { localStorage.removeItem('cinewall-account-used'); } catch {} }
      });
    });
    $('#showPassword')?.addEventListener('click', () => {
      const show = $('#password').type === 'password';
      $('#password').type = show ? 'text' : 'password';
      $('#showPassword').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      $('#showPassword').setAttribute('aria-pressed', String(show));
    });
    $('#googleSignIn').addEventListener('click', () => run(() => sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider())));
    $('#toggleSignup').addEventListener('click', () => {
      signup = !signup; $('#emailSubmit').textContent = signup ? 'Create account' : 'Sign in';
      $('#toggleSignup').textContent = signup ? 'Already have an account?' : 'Create an account';
      $('#password').autocomplete = signup ? 'new-password' : 'current-password';
      $('#authTitle').textContent = signup ? 'Join CineWall.' : 'Welcome back.'; message('');
    });
    $('#emailForm').addEventListener('submit', event => {
      event.preventDefault(); void run(async () => {
        message(signup ? 'Creating your account…' : 'Signing in…');
        const email = $('#email').value.trim(), password = $('#password').value;
        if (signup) {
          const result = await sdk.createUserWithEmailAndPassword(auth, email, password);
          try { await sdk.sendEmailVerification(result.user); message('Check your inbox to verify your email.'); }
          catch { message('Account created. Use Verify email to resend your verification.'); }
        } else await sdk.signInWithEmailAndPassword(auth, email, password);
        $('#password').value = '';
      });
    });
    $('#resetPassword').addEventListener('click', () => run(async () => {
      if (!$('#email').reportValidity()) return;
      await sdk.sendPasswordResetEmail(auth, $('#email').value.trim()); message('If an account exists, a reset email will arrive shortly.');
    }));
    document.querySelectorAll('[data-auth-tab]').forEach(button => button.addEventListener('click', () => {
      const phone = button.dataset.authTab === 'phone';
      $('#emailForm').hidden = phone; $('#phoneForm').hidden = !phone; $('#codeForm').hidden = true;
      document.querySelectorAll('[data-auth-tab]').forEach(tab => tab.setAttribute('aria-pressed', String(tab === button))); message('');
    }));
    $('#phoneForm').addEventListener('submit', event => {
      event.preventDefault(); void run(async () => {
        const phone = $('#phone').value.replace(/[\s()-]/g, '');
        if (!/^\+[1-9]\d{7,14}$/.test(phone)) { message('Enter a phone number with its country code, such as +91.', true); $('#phone').focus(); return; }
        if (Date.now() < resendAt) { message('Wait a minute before requesting another code.'); return; }
        if (!verifier) verifier = new sdk.RecaptchaVerifier(auth, 'recaptcha', { size: 'normal' });
        message('Complete the check to receive your code.');
        try {
          confirmation = await sdk.signInWithPhoneNumber(auth, phone, verifier); resendAt = Date.now() + 60000;
          $('#phoneForm').hidden = true; $('#codeForm').hidden = false; message('Enter the six-digit code sent to your phone.'); $('#otp').focus();
        } finally { verifier.clear(); verifier = null; }
      });
    });
    $('#codeForm').addEventListener('submit', event => { event.preventDefault(); void run(async () => { if (confirmation) await confirmation.confirm($('#otp').value.trim()); $('#otp').value = ''; }); });
    $('#changePhone').addEventListener('click', () => { confirmation = null; $('#otp').value = ''; $('#codeForm').hidden = true; $('#phoneForm').hidden = false; message(''); });
    $('#verifyEmail').addEventListener('click', () => run(async () => { await sdk.sendEmailVerification(auth.currentUser); message('Verification email sent.'); }));
    $('#signOut').addEventListener('click', () => run(async () => {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw Error('Could not sign out');
      try {
        localStorage.setItem('cinewall-account-logout', String(Date.now()));
      } catch {}
      await sdk.signOut(auth); location.replace('/auth.html');
    }));
  } catch { message('Sign-in could not load. Check your connection and try again.', true); $('#authRetry').hidden = false; }
})();
