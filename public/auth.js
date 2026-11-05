'use strict';
(function animateAccountBackdrop() {
  const showcase = document.querySelector('.auth-showcase');
  const video = document.querySelector('.auth-showcase video');
  if (!showcase?.style || !video) return;
  const palettes = [
    ['#ff4d51', '#ad222a'], ['#ffce62', '#ff46b4'], ['#53dec0', '#179b91'],
    ['#4bb0d3', '#24216f'], ['#a8d8f9', '#658df7'], ['#913ff2', '#f44fa5'],
    ['#3db965', '#f0f850'], ['#ffd448', '#ff9e55'], ['#ffad36', '#ea1202'],
    ['#52f4f8', '#48b5f3'],
  ];
  const start = Math.floor(Math.random() * palettes.length);
  const layer = document.createElement('div');
  layer.className = 'auth-gradient';
  layer.setAttribute('aria-hidden', 'true');
  showcase.prepend(layer);
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let previous = -1;
  function sync(mediaTime) {
    const progress = !motion.matches && Number.isFinite(video.duration) && video.duration > 0 ? mediaTime / video.duration : 0;
    const phase = progress * palettes.length;
    const segment = Math.floor(phase);
    const index = (start + segment) % palettes.length;
    if (index !== previous) {
      showcase.style.setProperty('--auth-color', `linear-gradient(145deg, ${palettes[index].join(', ')})`);
      layer.style.setProperty('--auth-color', `linear-gradient(145deg, ${palettes[(index + 1) % palettes.length].join(', ')})`);
      previous = index;
    }
    const fraction = phase - segment;
    layer.style.opacity = String(fraction * fraction * (3 - 2 * fraction));
  }
  const syncPlayhead = () => sync(video.currentTime);
  for (const event of ['loadedmetadata', 'seeked', 'pause']) video.addEventListener(event, syncPlayhead);
  motion.addEventListener('change', syncPlayhead);
  if (typeof video.requestVideoFrameCallback === 'function') {
    const frame = (_, metadata) => {
      sync(metadata.mediaTime);
      video.requestVideoFrameCallback(frame);
    };
    video.requestVideoFrameCallback(frame);
  } else video.addEventListener('timeupdate', syncPlayhead);
  syncPlayhead();
})();

(async () => {
  const $ = selector => document.querySelector(selector), status = $('#authStatus');
  const profilePage = document.body?.dataset.authPage === 'profile';
  const dashboard = '/admin.html?mode=video';
  let next = dashboard;
  try {
    const requested = new URL(new URL(location.href).searchParams.get('next') || dashboard, location.origin);
    if (requested.origin === location.origin) {
      if (requested.pathname === '/' && requested.search === '?account=open') next = '/?account=open';
      else if (/^\/(?:admin|screen|share|mic|room|connect|profile)\.html$/.test(requested.pathname)) next = requested.pathname + requested.search;
    }
  } catch {}
  let busy = false, signup = false, verifier, confirmation, smsResendAt = 0, emailResendAt = 0, pendingDestination;
  $('#authRetry')?.addEventListener('click', () => location.reload());
  const message = (text, error = false) => {
    status.textContent = text;
    status.dataset.state = error ? 'error' : 'status';
    status.setAttribute('role', error ? 'alert' : 'status');
  };
  const errors = {
    'auth/invalid-credential': 'Check your email and password.', 'auth/invalid-login-credentials': 'Check your email and password.',
    'auth/user-disabled': 'This account is disabled.', 'auth/email-already-in-use': 'An account already uses this email. Sign in or reset your password.',
    'auth/weak-password': 'Choose a stronger password.', 'auth/popup-closed-by-user': 'Google sign-in was closed. Try again.',
    'auth/popup-blocked': 'Allow the Google sign-in popup and try again.', 'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
    'auth/invalid-verification-code': 'That code is incorrect. Try again.', 'auth/code-expired': 'That code expired. Request a new one.',
    'auth/unauthorized-domain': 'Sign-in is not enabled for this website yet.', 'auth/operation-not-allowed': 'This sign-in method has not been enabled yet.',
    'auth/network-request-failed': 'Could not reach the sign-in provider. Please try again.', 'auth/quota-exceeded': 'SMS sign-in is temporarily unavailable.',
    'auth/billing-not-enabled': 'SMS sign-in is unavailable. Continue with Google or email.',
    'auth/web-storage-unsupported': 'This browser blocks storage for Google sign-in. Open CineWall in a regular browser tab, or use email.',
    'auth/captcha-check-failed': 'The security check expired. Try sending the code again.',
    'auth/invalid-phone-number': 'Enter a valid phone number with its country code.',
  };
  async function run(action) {
    if (busy) return;
    busy = true;
    const panel = !$('#verificationPanel').hidden ? $('#verificationPanel') : $(profilePage ? '#accountPanel' : '#authForms');
    const controls = [...document.querySelectorAll('.auth-card button:not([disabled])')];
    panel.setAttribute('aria-busy', 'true');
    controls.forEach(button => { button.disabled = true; });
    try { await action(); } catch (error) { message(errors[error.code] || 'Could not complete that request. Please try again.', true); }
    finally { busy = false; panel.setAttribute('aria-busy', 'false'); controls.forEach(button => { button.disabled = false; }); if (pendingDestination) location.replace(pendingDestination); }
  }
  try {
    const response = await fetch('/api/auth/config', { cache: 'no-store' });
    if (!response.ok) throw new Error('Configuration unavailable');
    const config = await response.json();
    if (!config.enabled) { message('Sign-in is unavailable. Please try again later.', true); $('#authRetry').hidden = false; return; }
    const [appSdk, sdk] = await Promise.all([import('https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js'), import('https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js')]);
    const auth = sdk.getAuth(appSdk.initializeApp(config.config));
    sdk.useDeviceLanguage(auth);
    // getAuth already selects a supported browser persistence strategy.
    const sendVerification = async user => {
      if (!config.brandedVerification) { await sdk.sendEmailVerification(user); return; }
      const response = await fetch('/api/auth/verify-email', {
        method: 'POST', headers: { Authorization: `Bearer ${await user.getIdToken(true)}` },
      });
      if (!response.ok) throw Error('Verification email could not be sent');
    };
    function showVerification(user) {
      $('#authTitle').textContent = user.email ? 'Verify your email.' : 'Add your email.';
      $('#authIntro').hidden = true;
      $('#authForms').hidden = true;
      $('#accountPanel').hidden = true;
      $('#authRetry').hidden = true;
      $('#verificationPanel').hidden = false;
      $('#verificationHelp').textContent = user.email
        ? 'Open the verification link in your inbox. Check your spam or junk folder too.'
        : 'Add an email and verify it before opening the dashboard.';
      $('#verificationAddress').textContent = user.email || '';
      $('#linkEmailForm').hidden = Boolean(user.email);
      $('#checkVerification').hidden = !user.email;
      $('#resendVerification').hidden = !user.email;
      try { localStorage.removeItem('cinewall-account-used'); } catch {}
    }
    async function startSession(user, force = false) {
      const response = await fetch('/api/auth/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: await user.getIdToken(force) }),
      });
      if (response.status === 403 && (await response.json()).code === 'EMAIL_VERIFICATION_REQUIRED') return false;
      if (!response.ok) throw Error('Session unavailable');
      try { localStorage.setItem('cinewall-account-used', '1'); } catch {}
      return true;
    }
    function continueAfterSignIn() {
      if (pendingDestination) return;
      pendingDestination = next;
      if (!busy) location.replace(next);
    }
    let accountQueue = Promise.resolve(), refreshedUser, renderedAccount = false;
    sdk.onIdTokenChanged(auth, user => {
      accountQueue = accountQueue.catch(() => {}).then(async () => {
      if (user) {
        try {
          if (pendingDestination) return;
          const refresh = !user.emailVerified && !busy && refreshedUser !== user;
          if (refresh) {
            refreshedUser = user;
            try { await sdk.reload(user); } catch {}
          }
          if (!user.emailVerified || !await startSession(user, refresh)) {
            if (!renderedAccount && !busy) message('');
            renderedAccount = true;
            showVerification(user);
            return;
          }
          if (!profilePage) { continueAfterSignIn(); return; }
        } catch {
          message('Could not start your CineWall session. Try again.', true);
          $('#authRetry').hidden = false;
          return;
        }
      } else if (profilePage) { location.replace('/auth.html'); return; }
      else refreshedUser = undefined;
      $('#verificationPanel').hidden = true;
      $('#authIntro').hidden = false;
      $('#authForms').hidden = Boolean(user); $('#accountPanel').hidden = !user;
      $('#authTitle').textContent = user ? 'Your profile.' : 'Welcome back.';
      $('#authRetry').hidden = true;
      if (!renderedAccount && !busy) message('');
      renderedAccount = true;
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
    $('#googleSignIn').addEventListener('click', () => run(async () => {
      message('Opening Google sign-in…');
      await sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider());
    }));
    $('#toggleSignup').addEventListener('click', () => {
      signup = !signup; $('#emailSubmit').textContent = signup ? 'Create account' : 'Sign in';
      $('#toggleSignup').textContent = signup ? 'Already have an account?' : 'Create an account';
      $('#password').autocomplete = signup ? 'new-password' : 'current-password';
      $('#signupNameField').hidden = !signup;
      $('#signupName').disabled = !signup;
      $('#signupName').required = signup;
      $('#resetPassword').hidden = signup;
      $('#authTitle').textContent = signup ? 'Join CineWall.' : 'Welcome back.'; message('');
      if (signup) $('#signupName').focus();
    });
    $('#emailForm').addEventListener('submit', event => {
      event.preventDefault(); void run(async () => {
        message(signup ? 'Creating your account…' : 'Signing in…');
        const email = $('#email').value.trim(), password = $('#password').value;
        if (signup) {
          const name = $('#signupName').value.trim();
          if (!name || name.length > 80) { message('Enter your name to create an account.', true); $('#signupName').focus(); return; }
          const result = await sdk.createUserWithEmailAndPassword(auth, email, password);
          try { await sdk.updateProfile(result.user, { displayName: name }); }
          catch { /* The account exists; still send its verification link. */ }
          try { await sendVerification(result.user); emailResendAt = Date.now() + 60000; message('Verification email sent.'); }
          catch { message('Could not send the verification email. Use Resend email to try again.', true); }
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
      $('#emailForm').hidden = phone; $('#phoneForm').hidden = !phone || Boolean(confirmation); $('#codeForm').hidden = !phone || !confirmation;
      $('#authTitle').textContent = phone ? 'Sign in with your phone.' : signup ? 'Join CineWall.' : 'Welcome back.';
      document.querySelectorAll('[data-auth-tab]').forEach(tab => tab.setAttribute('aria-pressed', String(tab === button))); message('');
    }));
    $('#phoneForm').addEventListener('submit', event => {
      event.preventDefault(); void run(async () => {
        const phone = $('#phone').value.replace(/[\s()-]/g, '');
        if (!/^\+[1-9]\d{7,14}$/.test(phone)) { message('Enter a phone number with its country code, such as +91.', true); $('#phone').focus(); return; }
        if (Date.now() < smsResendAt) { message('Wait a minute before requesting another code.'); return; }
        if (!verifier) verifier = new sdk.RecaptchaVerifier(auth, 'recaptcha', { size: 'normal' });
        message('Complete the check to receive your code.');
        try {
          confirmation = await sdk.signInWithPhoneNumber(auth, phone, verifier); smsResendAt = Date.now() + 60000;
          $('#phoneForm').hidden = true; $('#codeForm').hidden = false; message('Enter the six-digit code sent to your phone.'); $('#otp').focus();
        } finally { verifier.clear(); verifier = null; }
      });
    });
    $('#codeForm').addEventListener('submit', event => { event.preventDefault(); void run(async () => { if (confirmation) await confirmation.confirm($('#otp').value.trim()); $('#otp').value = ''; }); });
    $('#changePhone').addEventListener('click', () => { confirmation = null; $('#otp').value = ''; $('#codeForm').hidden = true; $('#phoneForm').hidden = false; message(''); });
    $('#linkEmailForm').addEventListener('submit', event => {
      event.preventDefault();
      void run(async () => {
        const user = auth.currentUser;
        if (!user || user.email) return;
        const credential = sdk.EmailAuthProvider.credential($('#linkEmail').value.trim(), $('#linkPassword').value);
        const { user: linkedUser } = await sdk.linkWithCredential(user, credential);
        $('#linkPassword').value = '';
        showVerification(linkedUser);
        try { await sendVerification(linkedUser); emailResendAt = Date.now() + 60000; message('Verification email sent.'); }
        catch { message('Could not send the verification email. Use Resend email to try again.', true); }
      });
    });
    $('#checkVerification').addEventListener('click', () => run(async () => {
      const user = auth.currentUser;
      if (!user) return;
      await sdk.reload(user);
      if (!user.emailVerified || !await startSession(user, true)) {
        message('Your email is still waiting for verification. Check your inbox and spam folder.', true);
        return;
      }
      if (profilePage) location.reload();
      else continueAfterSignIn();
    }));
    $('#resendVerification').addEventListener('click', () => run(async () => {
      if (!auth.currentUser?.email) return;
      if (Date.now() < emailResendAt) { message('Wait a minute before requesting another email.'); return; }
      try { await sendVerification(auth.currentUser); emailResendAt = Date.now() + 60000; message('Verification email sent.'); }
      catch { message('Could not send the verification email. Please try again.', true); }
    }));
    $('#verifyEmail').addEventListener('click', () => run(async () => {
      const user = auth.currentUser;
      if (!user) return;
      await sdk.reload(user);
      if (user.emailVerified) {
        $('#verifyEmail').hidden = true; $('#verificationState').textContent = ''; message('Your email is verified.'); return;
      }
      try { await sendVerification(user); message('Verification email sent.'); }
      catch { message('Could not send the verification email. Wait a minute and try again.', true); }
    }));
    async function signOut(destination = '/auth.html') {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw Error('Could not sign out');
      await sdk.signOut(auth);
      try {
        localStorage.removeItem('cinewall-account-used');
        localStorage.setItem('cinewall-account-logout', String(Date.now()));
      } catch {}
      location.replace(destination);
    }
    $('#signOut').addEventListener('click', () => run(signOut));
    $('#changeAccount').addEventListener('click', () => run(() => signOut(`/auth.html?next=${encodeURIComponent(next)}`)));
  } catch { message('Sign-in could not load. Check your connection and try again.', true); $('#authRetry').hidden = false; }
})();
