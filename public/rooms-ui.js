'use strict';
(() => {
  const session = window.CineWallSession;
  if (!session) return;
  const names = { video: 'Video', audio: 'Audio', share: 'Screen sharing', mic: 'Mic and Speaker' };
  const dialog = document.createElement('dialog'); dialog.className = 'room-dialog'; dialog.setAttribute('aria-labelledby', 'roomTitle');
  dialog.innerHTML = `<button type="button" class="room-close" aria-label="Close room options">×</button><span class="room-kicker">LET’S CONNECT</span><h2 id="roomTitle"></h2><p id="roomIntro">Create a room, then share its short ID with your other devices.</p><div class="room-choices"><button class="room-choice" id="roomCreate" type="button"><span>＋</span><strong>Create room</strong><small>You control the room</small></button><button class="room-choice" id="roomJoinChoice" type="button"><span>↗</span><strong>Join room</strong><small>Enter a shared room ID</small></button></div><form id="roomJoinForm" hidden><label>Room ID<input id="roomCodeInput" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-EFGH" maxlength="16" required></label><label id="roomMicRole" hidden>Use this device as<select id="roomRole"><option value="screen">Laptop speaker</option><option value="phone">Phone microphone</option></select></label><label id="roomRecoveryLabel" hidden>Recovery key<input id="roomRecoveryInput" autocomplete="off" spellcheck="false"></label><button class="button accent" id="roomJoinSubmit" type="submit">Join room</button></form><p id="roomMessage" role="alert" hidden></p><button id="roomRecover" class="room-text-button" type="button">Lost admin access? Recover your room</button><small class="room-network-note">For Instant sharing, use the same Wi-Fi or hotspot. On a local server, use the same server address on every device.</small>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  let mode = 'video', recovery = false, previousFocus, pending = false;
  const message = text => { $('#roomMessage').textContent = text; $('#roomMessage').hidden = !text; };
  function show(selected) {
    mode = names[selected] ? selected : 'video'; recovery = false; previousFocus = document.activeElement;
    $('#roomTitle').textContent = `${names[mode]} room`; $('#roomJoinForm').hidden = true; $('.room-choices').hidden = false;
    $('#roomIntro').textContent = 'Create a room, then share its short ID with your other devices.';
    $('#roomRole').value = window.CineWallDeviceSupport?.isPhone ? 'phone' : 'screen';
    $('#roomRecoveryLabel').hidden = true; $('#roomRecoveryInput').required = false; $('#roomMicRole').hidden = mode !== 'mic'; message('');
    if (!dialog.open) dialog.showModal(); $('#roomCreate').focus();
  }
  const close = () => { if (!pending) { dialog.close(); previousFocus?.focus(); } };
  $('.room-close').addEventListener('click', close);
  dialog.addEventListener('click', event => { const bounds = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) close(); });
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  async function connect(action, body) {
    if (pending) return; pending = true; message(''); for (const button of dialog.querySelectorAll('button')) button.disabled = true;
    $('#roomIntro').textContent = action === 'create' ? 'Creating your room…' : 'Connecting to your room…';
    try {
      const result = await session.roomRequest(action, body);
      if (body.recoveryKey) { result.recoveryKey = body.recoveryKey; session.storage.set(`cinewall-room-${result.room}`, JSON.stringify(result)); }
      const target = new URL(result.path, location.origin); target.searchParams.set('room', result.room);
      // A room ticket also allows navigation when browser storage is disabled.
      try { if (!localStorage.getItem('cinewall-device')) target.searchParams.set('access', result.ticket); } catch { target.searchParams.set('access', result.ticket); }
      location.href = target.href;
    } catch (error) { message(error.message); $('#roomIntro').textContent = 'Try again when you are ready.'; }
    finally { pending = false; for (const button of dialog.querySelectorAll('button')) button.disabled = false; }
  }
  $('#roomCreate').addEventListener('click', () => connect('create', { mode }));
  $('#roomJoinChoice').addEventListener('click', () => { $('.room-choices').hidden = true; $('#roomJoinForm').hidden = false; $('#roomJoinSubmit').textContent = 'Join room'; $('#roomCodeInput').focus(); });
  $('#roomJoinForm').addEventListener('submit', event => { event.preventDefault(); connect(recovery ? 'recover' : 'join', { code: $('#roomCodeInput').value, mode, role: $('#roomRole').value, ...(recovery ? { recoveryKey: $('#roomRecoveryInput').value.trim() } : {}) }); });
  $('#roomRecover').addEventListener('click', () => { recovery = true; $('.room-choices').hidden = true; $('#roomJoinForm').hidden = false; $('#roomRecoveryLabel').hidden = false; $('#roomRecoveryInput').required = true; $('#roomMicRole').hidden = true; $('#roomJoinSubmit').textContent = 'Recover admin access'; $('#roomIntro').textContent = 'Use your saved recovery key. Keep it private.'; $('#roomCodeInput').focus(); });
  document.addEventListener('click', event => {
    const target = event.target.closest('.mode-grid [data-session-mode], a[href]'); if (!target || target.closest('.coming-soon')) return;
    let selected = target.dataset.sessionMode;
    if (!selected && target.tagName === 'A') { const url = new URL(target.href, location.href); if (url.origin === location.origin && !url.searchParams.has('room')) selected = url.pathname === '/share.html' ? 'share' : url.pathname === '/mic.html' ? 'mic' : null; }
    if (!names[selected] || window.CineWallDeviceSupport?.isPhone && selected !== 'mic') return;
    event.preventDefault(); event.stopImmediatePropagation(); show(selected);
  }, true);
  const pageMode = () => location.pathname.includes('mic') ? 'mic' : location.pathname.includes('share') ? 'share' : new URL(location.href).searchParams.get('mode') || 'video';
  window.addEventListener('cinewall-room-error', event => { for (const media of document.querySelectorAll('video,audio')) media.pause(); show(pageMode()); message(event.detail); });
  const isRoomPage = /\/(admin|screen|share|mic)\.html$/.test(location.pathname);
  if (isRoomPage && !session.room) show(pageMode());
  if (session.room && isRoomPage) session.ready.then(info => {
    document.body.dataset.roomRole = info.admin ? 'admin' : 'guest';
    const bar = document.createElement('section'); bar.className = 'room-identity'; bar.setAttribute('aria-label', 'Room connection');
    const label = document.createElement('span'); label.textContent = info.admin ? 'YOUR ROOM ID' : 'CONNECTED TO ROOM';
    const code = document.createElement('strong'); code.textContent = info.code;
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy room ID';
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(info.code); copy.textContent = 'Copied!'; } catch { const range = document.createRange(); range.selectNodeContents(code); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); copy.textContent = 'Select and copy'; } setTimeout(() => copy.textContent = 'Copy room ID', 1800); });
    const note = document.createElement('small'); note.textContent = info.admin ? 'Share this ID. Guests choose Join room.' : info.role === 'phone' ? 'Phone microphone' : `Your ${info.mode === 'audio' || info.mode === 'mic' ? 'speaker' : 'screen'}: ${info.screen}`;
    bar.append(label, code, copy, note);
    if (!info.admin) { const leave = document.createElement('button'); leave.type = 'button'; leave.textContent = 'Leave room'; leave.addEventListener('click', async () => { leave.disabled = true; try { const response = await fetch(session.link('/api/rooms/leave'), { method: 'POST' }); if (!response.ok) throw new Error(); session.storage.remove(`cinewall-room-${info.room}`); location.href = '/'; } catch { leave.disabled = false; leave.textContent = 'Try leaving again'; } }); bar.append(leave); }
    if (info.admin && info.recoveryKey) { const details = document.createElement('details'), summary = document.createElement('summary'), key = document.createElement('code'), help = document.createElement('small'); summary.textContent = 'Admin recovery key'; key.textContent = info.recoveryKey; help.textContent = 'Save privately to recover access if your browser data is lost.'; details.append(summary, key, help); bar.append(details); }
    document.querySelector('main')?.prepend(bar);
    if (!info.admin && info.mode === 'mic') document.querySelector('#addLaptop')?.setAttribute('hidden', '');
  }).catch(() => {});
})();
