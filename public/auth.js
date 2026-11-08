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
  const usedKey = 'cinewall-account-used', returningKey = 'cinewall-account-returning';
  const authUrl = new URL(location.href);
  const intent = authUrl.searchParams.get('intent');
  let returning = false;
  try { returning = localStorage.getItem(returningKey) === '1' || localStorage.getItem(usedKey) === '1'; } catch {}
  let busy = false, leaving = false, signup = intent === 'signup' || (intent !== 'signin' && !returning);
  let phoneMode = false, confirmation, lastSmsNumber, smsResendAt = 0, emailResendAt = 0;
  let refreshAccount = () => {}, syncAfterAction = false, forceAfterAction = false;
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
    'auth/session-expired': 'That code expired. Request a new one.',
    'auth/unauthorized-domain': 'Sign-in is not enabled for this website yet.', 'auth/operation-not-allowed': 'This sign-in method has not been enabled yet.',
    'auth/network-request-failed': 'Could not reach the sign-in provider. Please try again.', 'auth/quota-exceeded': 'SMS sign-in is temporarily unavailable.',
    'auth/billing-not-enabled': 'SMS sign-in is unavailable. Continue with Google or email.',
    'auth/web-storage-unsupported': 'This browser blocks storage for Google sign-in. Open CineWall in a regular browser tab, or use email.',
    'auth/captcha-check-failed': 'The security check expired. Try sending the code again.',
    'auth/invalid-phone-number': 'Enter a valid phone number with its country code.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/user-not-found': 'Check your email and password.',
    'auth/wrong-password': 'Check your email and password.',
    'auth/account-exists-with-different-credential': 'This email already uses another sign-in method. Sign in with that method.',
    'auth/credential-already-in-use': 'This email belongs to another account. Use another email or switch accounts.',
    'auth/password-does-not-meet-requirements': 'Choose a password that meets the password requirements.',
    'auth/user-token-expired': 'Your sign-in expired. Use another account to sign in again.',
    'auth/invalid-user-token': 'Your sign-in expired. Use another account to sign in again.',
  };
  async function run(action) {
    if (busy || leaving) return;
    busy = true;
    const panel = !$('#verificationPanel').hidden ? $('#verificationPanel') : $(profilePage ? '#accountPanel' : '#authForms');
    const controls = [...document.querySelectorAll('.auth-card button:not([disabled])')];
    panel.setAttribute('aria-busy', 'true');
    controls.forEach(button => { button.disabled = true; });
    try { await action(); } catch (error) { message(errors[error.code] || 'Could not complete that request. Please try again.', true); }
    finally {
      busy = false;
      panel.setAttribute('aria-busy', 'false');
      controls.forEach(button => { button.disabled = false; });
      if (syncAfterAction) { syncAfterAction = false; refreshAccount(undefined, forceAfterAction); forceAfterAction = false; }
    }
  }
  function showEmailMode() {
    $('#authTitle').textContent = signup ? 'Create your account.' : 'Welcome back.';
    $('#authIntro').textContent = signup ? 'One account for all your screens.' : 'Sign in to CineWall.';
    $('#emailSubmit').textContent = signup ? 'Create account' : 'Sign in';
    $('#toggleSignup').textContent = signup ? 'Already have an account? Sign in' : 'New here? Create an account';
    $('#password').autocomplete = signup ? 'new-password' : 'current-password';
    $('#password').minLength = signup ? 6 : 0;
    $('#signupNameField').hidden = !signup;
    $('#signupName').disabled = !signup;
    $('#signupName').required = signup;
    $('#resetPassword').hidden = signup;
  }
  if (!profilePage) showEmailMode();
  let retry = () => location.reload();
  $('#authRetry')?.addEventListener('click', () => retry());
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
      if (response.status === 429) {
        emailResendAt = Date.now() + 60000;
        throw Object.assign(Error(), { code: 'auth/too-many-requests' });
      }
      if (!response.ok) throw Error('Verification email could not be sent');
    };
    async function deliverVerification(user) {
      try {
        await sendVerification(user);
        emailResendAt = Date.now() + 60000;
        message('Verification email sent.');
      } catch (error) {
        message(errors[error.code] || 'Could not send the verification email. Use Resend email to try again.', true);
      }
    }
    function rememberAccount(active) {
      try {
        localStorage.setItem(returningKey, '1');
        if (active) localStorage.setItem(usedKey, '1');
        else localStorage.removeItem(usedKey);
      } catch {}
    }
    function showVerification(user) {
      $('#authTitle').textContent = user.email ? 'Verify your email.' : 'Add your email.';
      $('#authIntro').hidden = true;
      $('#authForms').hidden = true;
      $('#accountPanel').hidden = true;
      $('#authRetry').hidden = true;
      $('#authSwitchAccount').hidden = true;
      $('#verificationPanel').hidden = false;
      $('#verificationHelp').textContent = user.email
        ? 'Open the verification link in your inbox. Check your spam or junk folder too.'
        : 'Add an email and verify it before opening the dashboard.';
      $('#verificationAddress').textContent = user.email || '';
      $('#linkEmailForm').hidden = Boolean(user.email);
      $('#checkVerification').hidden = !user.email;
      $('#resendVerification').hidden = !user.email;
      rememberAccount(false);
    }
    async function startSession(user, force = false) {
      const idToken = await user.getIdToken(force);
      if (auth.currentUser !== user || leaving) return false;
      const response = await fetch('/api/auth/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      if (auth.currentUser !== user || leaving) return false;
      if (response.status === 403 && (await response.json()).code === 'EMAIL_VERIFICATION_REQUIRED') return force ? false : startSession(user, true);
      if (!force && response.status === 401) return startSession(user, true);
      if (!response.ok) throw Error('Session unavailable');
      rememberAccount(true);
      return true;
    }
    function showProfile(user) {
      $('#verificationPanel').hidden = true;
      $('#authForms').hidden = true;
      $('#authIntro').hidden = true;
      $('#accountPanel').hidden = false;
      $('#authRetry').hidden = true;
      $('#authSwitchAccount').hidden = true;
      $('#authTitle').textContent = 'Your profile.';
      $('#profileName').textContent = user.displayName || 'CineWall account';
      $('#profileEmail').textContent = user.email || 'Not added';
      $('#profilePhone').textContent = user.phoneNumber || 'Not added';
      $('#profileAvatar').textContent = (Array.from(user.displayName || user.email || 'C')[0]).toUpperCase();
    }
    let accountQueue = Promise.resolve(), refreshedUser, firstState = true, hadProviderUser = false;
    function enter(user) {
      message('');
      if (profilePage) showProfile(user);
      else { leaving = true; location.replace(next); }
    }
    function sessionError() {
      message('Could not start your CineWall session. Please try again.', true);
      $('#authRetry').hidden = false;
      $('#authSwitchAccount').hidden = !auth.currentUser || !$('#verificationPanel').hidden || !$('#accountPanel').hidden;
      if (auth.currentUser) $('#authForms').hidden = true;
    }
    refreshAccount = (user = auth.currentUser, force = false) => {
      accountQueue = accountQueue.then(async () => {
        if (leaving || auth.currentUser !== user) return;
        if (busy) { syncAfterAction = true; return; }
        if (firstState) { firstState = false; message(''); }
        if (!user) {
          refreshedUser = undefined;
          // The server session is usable even when browser storage cannot restore Firebase.
          if (!hadProviderUser) {
            const response = await fetch('/api/auth/session', { cache: 'no-store' });
            if (!response.ok) throw Error('Session unavailable');
            const state = await response.json();
            if (auth.currentUser || leaving) return;
            if (state.authenticated) {
              rememberAccount(true);
              enter({ displayName: state.account?.name, email: state.account?.email, phoneNumber: state.account?.phone });
              return;
            }
          }
          if (profilePage) { leaving = true; location.replace('/auth.html?next=%2Fprofile.html'); return; }
          $('#verificationPanel').hidden = true;
          $('#accountPanel').hidden = true;
          $('#authRetry').hidden = true;
          $('#authSwitchAccount').hidden = true;
          $('#authIntro').hidden = false;
          if (!phoneMode) showEmailMode();
          $('#authForms').hidden = false;
          return;
        }
        hadProviderUser = true;
        if (user.email && !user.emailVerified && refreshedUser !== user) {
          refreshedUser = user;
          // A verification link may have been opened since this browser last loaded the account.
          try { await sdk.reload(user); force = true; } catch {}
        }
        if (auth.currentUser !== user || leaving) return;
        if (!user.emailVerified || !await startSession(user, force)) {
          if (auth.currentUser === user && !leaving) showVerification(user);
          return;
        }
        enter(user);
      }).catch(() => { if (auth.currentUser === user && !leaving) sessionError(); });
    };
    retry = () => {
      $('#authRetry').hidden = true;
      $('#authSwitchAccount').hidden = true;
      message('Connecting…');
      refreshAccount(auth.currentUser, true);
    };
    sdk.onIdTokenChanged(auth, user => refreshAccount(user));
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
      signup = !signup;
      $('#password').value = '';
      $('#password').type = 'password';
      $('#showPassword').setAttribute('aria-label', 'Show password');
      $('#showPassword').setAttribute('aria-pressed', 'false');
      showEmailMode();
      message('');
      $(signup ? '#signupName' : '#email').focus();
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
          await deliverVerification(result.user);
        } else await sdk.signInWithEmailAndPassword(auth, email, password);
        $('#password').value = '';
      });
    });
    $('#resetPassword').addEventListener('click', () => run(async () => {
      if (!$('#email').reportValidity()) { $('#email').focus(); return; }
      try { await sdk.sendPasswordResetEmail(auth, $('#email').value.trim()); }
      catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
      message('If an account exists, a reset email will arrive shortly. Check spam or junk too.');
    }));
    document.querySelectorAll('[data-auth-tab]').forEach(button => button.addEventListener('click', () => {
      phoneMode = button.dataset.authTab === 'phone';
      $('#emailForm').hidden = phoneMode;
      $('#phoneForm').hidden = !phoneMode || Boolean(confirmation);
      $('#codeForm').hidden = !phoneMode || !confirmation;
      if (phoneMode) {
        $('#authTitle').textContent = 'Continue with your phone.';
        $('#authIntro').textContent = 'We’ll text you a six-digit code.';
      } else showEmailMode();
      document.querySelectorAll('[data-auth-tab]').forEach(tab => tab.setAttribute('aria-pressed', String(tab === button))); message('');
    }));
    $('#phoneForm').addEventListener('submit', event => {
      event.preventDefault(); void run(async () => {
        const phone = $('#phone').value.replace(/[\s()-]/g, '');
        if (!/^\+[1-9]\d{7,14}$/.test(phone)) { message('Enter a phone number with its country code, such as +91.', true); $('#phone').focus(); return; }
        if (phone === lastSmsNumber && Date.now() < smsResendAt) { message('Wait a minute before requesting another code.'); return; }
        const verifier = new sdk.RecaptchaVerifier(auth, 'recaptcha', { size: 'normal' });
        message('Complete the check to receive your code.');
        try {
          confirmation = await sdk.signInWithPhoneNumber(auth, phone, verifier);
          smsResendAt = Date.now() + 60000;
          lastSmsNumber = phone;
          $('#phoneForm').hidden = true; $('#codeForm').hidden = false; message('Enter the six-digit code sent to your phone.'); $('#otp').focus();
        } finally { verifier.clear(); }
      });
    });
    function resetCode() {
      confirmation = null;
      $('#otp').value = '';
      $('#codeForm').hidden = true;
      $('#phoneForm').hidden = false;
      $('#phone').focus();
    }
    $('#codeForm').addEventListener('submit', event => {
      event.preventDefault();
      void run(async () => {
        if (!confirmation) return;
        try { await confirmation.confirm($('#otp').value.trim()); $('#otp').value = ''; }
        catch (error) {
          if (error.code === 'auth/code-expired' || error.code === 'auth/session-expired') { smsResendAt = 0; resetCode(); }
          if (error.code === 'auth/invalid-verification-code') { $('#otp').value = ''; $('#otp').focus(); }
          throw error;
        }
      });
    });
    $('#changePhone').addEventListener('click', () => { resetCode(); message(''); });
    $('#linkEmailForm').addEventListener('submit', event => {
      event.preventDefault();
      void run(async () => {
        const user = auth.currentUser;
        if (!user || user.email) return;
        const credential = sdk.EmailAuthProvider.credential($('#linkEmail').value.trim(), $('#linkPassword').value);
        const { user: linkedUser } = await sdk.linkWithCredential(user, credential);
        $('#linkPassword').value = '';
        showVerification(linkedUser);
      await deliverVerification(linkedUser);
      });
    });
    $('#checkVerification').addEventListener('click', () => run(async () => {
      const user = auth.currentUser;
      if (!user) return;
      await accountQueue;
      await sdk.reload(user);
      if (auth.currentUser !== user) return;
      if (!user.emailVerified) {
        message('Your email is still waiting for verification. Check your inbox and spam folder.', true);
        return;
      }
      $('#verificationPanel').hidden = true;
      message('Opening CineWall…');
      syncAfterAction = forceAfterAction = true;
    }));
    $('#resendVerification').addEventListener('click', () => run(async () => {
      if (!auth.currentUser?.email) return;
      if (Date.now() < emailResendAt) { message('Wait a minute before requesting another email.'); return; }
      await deliverVerification(auth.currentUser);
    }));
    async function signOut(destination = '/auth.html?intent=signin') {
      leaving = true;
      try {
        await accountQueue;
        const response = await fetch('/api/auth/logout', { method: 'POST' });
        if (!response.ok) throw Error('Could not sign out');
        await sdk.signOut(auth);
        rememberAccount(false);
        try { localStorage.setItem('cinewall-account-logout', String(Date.now())); } catch {}
        location.replace(destination);
      } catch {
        leaving = false;
        message('Could not log out. Check your connection and try again.', true);
      }
    }
    $('#signOut').addEventListener('click', () => run(signOut));
    const changeAccount = () => run(() => signOut(`/auth.html?intent=signin&next=${encodeURIComponent(profilePage ? '/profile.html' : next)}`));
    $('#changeAccount').addEventListener('click', changeAccount);
    $('#authSwitchAccount').addEventListener('click', changeAccount);
    if (profilePage) window.addEventListener('storage', event => {
      if (leaving || event.key !== 'cinewall-account-logout' || !event.newValue) return;
      leaving = true;
      $('#accountPanel').hidden = true;
      location.replace('/auth.html?intent=signin&next=%2Fprofile.html');
    });
  } catch { message('Sign-in could not load. Check your connection and try again.', true); $('#authRetry').hidden = false; }
})();
