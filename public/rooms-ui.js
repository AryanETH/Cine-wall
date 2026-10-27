'use strict';
(() => {
  const session = window.CineWallSession;
  if (!session) return;
  const names = { video: 'Video', audio: 'Audio', share: 'Screen sharing', mic: 'Mic and Speaker' };
  const dialog = document.createElement('dialog'); dialog.className = 'room-dialog'; dialog.setAttribute('aria-labelledby', 'roomTitle');
  dialog.innerHTML = `<button type="button" class="room-close" aria-label="Close room options">×</button><span class="room-kicker">LET’S CONNECT</span><h2 id="roomTitle"></h2><p id="roomIntro">One room ID for movies, music, sharing and your mic.</p><div class="room-choices"><button class="room-choice" id="roomCreate" type="button"><span aria-hidden="true">＋</span><strong>Create room</strong><small>Host it. Make it yours.</small></button><button class="room-choice" id="roomJoinChoice" type="button"><span aria-hidden="true">↗</span><strong>Join room</strong><small>Have a code? Come in.</small></button></div><form id="roomJoinForm" hidden><label>Room ID<input id="roomCodeInput" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-EFGH" maxlength="16" required></label><label id="roomMicRole" hidden>Use this device as<select id="roomRole"><option value="screen">Laptop speaker</option><option value="phone">Phone microphone</option></select></label><label id="roomRecoveryLabel" hidden>Recovery key<input id="roomRecoveryInput" autocomplete="off" spellcheck="false"></label><button class="button accent" id="roomJoinSubmit" type="submit">Join room</button></form><p id="roomMessage" role="alert" hidden></p><button id="roomRecover" class="room-text-button" type="button">Recover admin access ↗</button><small class="room-network-note">Same Wi-Fi or hotspot for Instant sharing. Running locally? Open the same server address on every device.</small>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  let mode = 'video', recovery = false, previousFocus, pending = false;
  const message = text => { $('#roomMessage').textContent = text; $('#roomMessage').hidden = !text; };
  function show(selected) {
    mode = names[selected] ? selected : 'video'; recovery = false; previousFocus = document.activeElement;
    $('#roomTitle').textContent = `${names[mode]} room`; $('#roomJoinForm').hidden = true; $('.room-choices').hidden = false;
    $('#roomIntro').textContent = 'One room ID for movies, music, sharing and your mic.';
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
  $('#roomJoinForm').addEventListener('submit', event => { event.preventDefault(); connect(recovery ? 'recover' : 'join', { code: $('#roomCodeInput').value, mode, role: $('#roomRole').value, deviceKind: window.CineWallDeviceSupport?.isPhone ? 'phone' : 'laptop', ...(recovery ? { recoveryKey: $('#roomRecoveryInput').value.trim() } : {}) }); });
  $('#roomRecover').addEventListener('click', () => { recovery = true; $('.room-choices').hidden = true; $('#roomJoinForm').hidden = false; $('#roomRecoveryLabel').hidden = false; $('#roomRecoveryInput').required = true; $('#roomMicRole').hidden = true; $('#roomJoinSubmit').textContent = 'Recover admin access'; $('#roomIntro').textContent = 'Use your saved recovery key. Keep it private.'; $('#roomCodeInput').focus(); });
  document.addEventListener('click', event => {
    const target = event.target.closest('.mode-grid [data-session-mode], a[href]'); if (!target || target.closest('.coming-soon')) return;
    let selected = target.dataset.sessionMode;
    if (!selected && target.tagName === 'A') { const url = new URL(target.href, location.href); if (url.origin === location.origin) selected = url.pathname === '/share.html' ? 'share' : url.pathname === '/mic.html' ? 'mic' : null; }
    if (!names[selected] || window.CineWallDeviceSupport?.isPhone && selected !== 'mic') return;
    // Role links within the mic room do not change the room's mode.
    if (selected === 'mic' && location.pathname === '/mic.html' && target.matches('#phoneRole,#speakerRole')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (session.room) session.ready.then(info => info ? info.admin ? session.switchMode(selected) : session.navigate(info) : show(selected)).catch(error => { show(selected); message(error.message); });
    else show(selected);
  }, true);
  const pageMode = () => location.pathname.includes('mic') ? 'mic' : location.pathname.includes('share') ? 'share' : new URL(location.href).searchParams.get('mode') || 'video';
  window.addEventListener('cinewall-room-error', event => { for (const media of document.querySelectorAll('video,audio')) media.pause(); show(pageMode()); message(event.detail); });
  const isRoomPage = /\/(admin|screen|share|mic|room)\.html$/.test(location.pathname);
  if (isRoomPage && !session.room) show(pageMode());
  if (session.room && (isRoomPage || location.pathname === '/')) session.ready.then(info => {
    if (!info) return;
    document.body.dataset.roomRole = info.admin ? 'admin' : 'guest';
    const bar = document.createElement('section'); bar.className = 'room-identity'; bar.setAttribute('aria-label', 'Room connection');
    const label = document.createElement('span'); label.textContent = info.admin ? 'YOUR ROOM ID' : 'CONNECTED TO ROOM';
    const code = document.createElement('strong'); code.textContent = info.code;
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy room ID';
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(info.code); copy.textContent = 'Copied!'; } catch { const range = document.createRange(); range.selectNodeContents(code); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); copy.textContent = 'Select and copy'; } setTimeout(() => copy.textContent = 'Copy room ID', 1800); });
    const note = document.createElement('small');
    const updateNote = current => { note.textContent = current.admin ? 'One code. Your guests follow every mode switch.' : current.waiting ? `Still connected · waiting for a place in ${names[current.mode]}` : current.role === 'phone' ? 'Phone microphone' : `${names[current.mode]} · ${current.mode === 'audio' || current.mode === 'mic' ? 'Speaker' : 'Screen'} ${current.screen}`; };
    updateNote(info); window.addEventListener('cinewall-room-updated', event => updateNote(event.detail));
    bar.append(label, code, copy, note);
    if (info.admin) {
      const field = document.createElement('label'); field.className = 'room-mode-field'; field.textContent = 'Mode';
      const select = document.createElement('select'); select.setAttribute('aria-label', 'Room mode');
      for (const [value, name] of Object.entries(names)) { const option = document.createElement('option'); option.value = value; option.textContent = name; select.append(option); }
      select.value = info.mode; field.append(select); bar.append(field);
      select.addEventListener('change', async () => { select.disabled = true; try { await session.switchMode(select.value); } catch (error) { select.value = info.mode; select.disabled = false; note.textContent = error.message; } });
    }
    const newRoom = document.createElement('a'); newRoom.href = '/?new=1'; newRoom.className = 'room-new-link'; newRoom.textContent = 'Start another room'; bar.append(newRoom);
    if (!info.admin) { const leave = document.createElement('button'); leave.type = 'button'; leave.textContent = 'Leave room'; leave.addEventListener('click', async () => { leave.disabled = true; try { const response = await fetch(session.link('/api/rooms/leave'), { method: 'POST' }); if (!response.ok) throw new Error(); session.storage.remove(`cinewall-room-${info.room}`); location.href = '/'; } catch { leave.disabled = false; leave.textContent = 'Try leaving again'; } }); bar.append(leave); }
    if (info.admin && info.recoveryKey) { const details = document.createElement('details'), summary = document.createElement('summary'), key = document.createElement('code'), help = document.createElement('small'); summary.textContent = 'Admin recovery key'; key.textContent = info.recoveryKey; help.textContent = 'Save privately to recover access if your browser data is lost.'; details.append(summary, key, help); bar.append(details); }
    const header = document.querySelector('main > header'); if (header) header.insertAdjacentElement('afterend', bar); else document.querySelector('main')?.prepend(bar);
    if (!info.admin && info.mode === 'mic') document.querySelector('#addLaptop')?.setAttribute('hidden', '');
  }).catch(() => {});
})();
