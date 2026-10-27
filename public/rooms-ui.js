'use strict';
(() => {
  const session = window.CineWallSession;
  if (!session || window.CineWallDeviceSupport?.restricted) return;
  const entry = document.querySelector('[data-room-entry]');
  if (entry) entry.innerHTML = '<section class="room-entry-card"><h1>Opening your workspace…</h1><p role="status">Getting your sharing links ready.</p></section>';

  let errorDialog;
  window.addEventListener('cinewall-room-error', event => {
    for (const media of document.querySelectorAll('video,audio')) media.pause();
    if (!errorDialog) {
      errorDialog = document.createElement('dialog');
      errorDialog.className = 'room-dialog';
      errorDialog.setAttribute('aria-labelledby', 'connectionTitle');
      errorDialog.innerHTML = '<h2 id="connectionTitle">Could not connect</h2><p role="alert"></p><div class="room-error-actions"><button class="button accent" type="button">Try again</button><a class="button subtle" href="/">All modes</a></div>';
      errorDialog.querySelector('button').addEventListener('click', () => location.reload());
      document.body.append(errorDialog);
    }
    errorDialog.querySelector('p').textContent = event.detail;
    if (!errorDialog.open) errorDialog.showModal();
  });

  session.ready.then(info => {
    if (!info) return;
    document.body.dataset.roomRole = info.admin ? 'admin' : 'guest';
    if (!info.admin && info.mode === 'mic') document.querySelector('#addLaptop')?.setAttribute('hidden', '');
  }).catch(() => {});

})();
