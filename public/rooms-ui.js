'use strict';
(() => {
  const session = window.CineWallSession;
  if (!session || window.CineWallDeviceSupport?.restricted) return;
  const names = { video: 'Video', audio: 'Audio', share: 'Screen sharing', mic: 'Mic and Speaker' };
  const isEntry = location.pathname === '/connect.html';
  const isHome = location.pathname === '/';
  const isRoomPage = /\/(admin|screen|share|mic|room)\.html$/.test(location.pathname);
  const entryLink = (mode, join = false) => `/connect.html?mode=${encodeURIComponent(names[mode] ? mode : 'video')}${join ? '&join=1' : ''}`;
  const pageMode = () => location.pathname.includes('mic') ? 'mic' : location.pathname.includes('share') ? 'share' : new URL(location.href).searchParams.get('mode') || 'video';
  const dialog = document.createElement('dialog');
  dialog.className = `room-dialog${isEntry ? ' room-entry-card' : ''}`;
  dialog.setAttribute('aria-labelledby', 'roomTitle');
  dialog.innerHTML = `<button type="button" class="room-close" aria-label="Close room options">×</button><span class="room-kicker">LET’S CONNECT</span><h2 id="roomTitle"></h2><p id="roomIntro">Create a room or join with a code.</p><div class="room-choices"><button class="room-choice room-choice-primary" id="roomCreate" type="button"><span class="room-choice-icon" aria-hidden="true">＋</span><strong>Create room</strong><small>You control the room</small><span class="room-choice-arrow" aria-hidden="true">↗</span></button><button class="room-choice" id="roomJoinChoice" type="button"><span class="room-choice-icon" aria-hidden="true">↗</span><strong>Join room</strong><small>Enter a shared room code</small><span class="room-choice-arrow" aria-hidden="true">↗</span></button></div><form id="roomJoinForm" hidden><button type="button" id="roomBack" class="room-text-button">← Create or join</button><label>Room code<input id="roomCodeInput" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-EFGH" maxlength="16" required></label><label id="roomMicRole" hidden>Use this device as<select id="roomRole"><option value="screen">Laptop speaker</option><option value="phone">Phone microphone</option></select></label><label id="roomRecoveryLabel" hidden>Recovery key<input id="roomRecoveryInput" autocomplete="off" spellcheck="false"></label><button class="button accent" id="roomJoinSubmit" type="submit">Join room</button></form><p id="roomMessage" role="alert" hidden></p><button id="roomRecover" class="room-text-button" type="button">Recover admin access</button><small class="room-network-note">Use the same Wi-Fi or hotspot for Instant sharing.</small>`;
  (document.querySelector('[data-room-entry]') || document.body).append(dialog);
  const $ = selector => dialog.querySelector(selector);
  let mode = 'video', recovery = false, previousFocus, pending = false;
  const message = text => { $('#roomMessage').textContent = text; $('#roomMessage').hidden = !text; };
  function show(selected) {
    mode = names[selected] ? selected : 'video'; recovery = false; previousFocus = document.activeElement;
    $('#roomTitle').textContent = `${names[mode]} room`;
    $('#roomJoinForm').hidden = true; $('.room-choices').hidden = false;
    $('#roomIntro').textContent = 'Create a room or join with a code.';
    $('#roomRole').value = window.CineWallDeviceSupport?.isPhone ? 'phone' : 'screen';
    $('#roomRecoveryLabel').hidden = true; $('#roomRecoveryInput').required = false;
    $('#roomMicRole').hidden = mode !== 'mic'; message('');
    if (!dialog.open) { if (isEntry) dialog.show(); else dialog.showModal(); }
    $('#roomCreate').focus();
  }
  function showJoin() {
    $('.room-choices').hidden = true; $('#roomJoinForm').hidden = false;
    $('#roomJoinSubmit').textContent = 'Join room'; $('#roomCodeInput').focus();
  }
  $('.room-close').addEventListener('click', () => { if (!pending) { dialog.close(); previousFocus?.focus(); } });
  dialog.addEventListener('click', event => {
    if (isEntry || pending) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  async function connect(action, body) {
    if (pending) return;
    pending = true; message(''); for (const button of dialog.querySelectorAll('button')) button.disabled = true;
    $('#roomIntro').textContent = action === 'create' ? 'Creating your room…' : 'Connecting to your room…';
    try {
      const result = await session.roomRequest(action, body);
      if (body.recoveryKey) { result.recoveryKey = body.recoveryKey; session.storage.set(`cinewall-room-${result.room}`, JSON.stringify(result)); }
      session.navigate(result);
    } catch (error) { message(error.message); $('#roomIntro').textContent = 'Check the details and try again.'; }
    finally { pending = false; for (const button of dialog.querySelectorAll('button')) button.disabled = false; }
  }
  $('#roomCreate').addEventListener('click', () => connect('create', { mode }));
  $('#roomJoinChoice').addEventListener('click', showJoin);
  $('#roomBack').addEventListener('click', () => show(mode));
  $('#roomJoinForm').addEventListener('submit', event => {
    event.preventDefault();
    connect(recovery ? 'recover' : 'join', { code: $('#roomCodeInput').value, mode, role: $('#roomRole').value,
      deviceKind: window.CineWallDeviceSupport?.isPhone ? 'phone' : 'laptop', ...(recovery ? { recoveryKey: $('#roomRecoveryInput').value.trim() } : {}) });
  });
  $('#roomRecover').addEventListener('click', () => {
    recovery = true; showJoin(); $('#roomRecoveryLabel').hidden = false; $('#roomRecoveryInput').required = true;
    $('#roomMicRole').hidden = true; $('#roomJoinSubmit').textContent = 'Recover admin access'; $('#roomIntro').textContent = 'Use your saved recovery key. Keep it private.';
  });
  document.addEventListener('click', event => {
    // Studio bodies also carry data-session-mode; never treat their ordinary
    // buttons (Play, Copy, Skip, etc.) as feature-card clicks.
    const target = event.target.closest('.mode-grid [data-session-mode], a[href]');
    if (!target || target.closest('.coming-soon')) return;
    if (target.tagName === 'A' && new URL(target.href, location.href).pathname === '/connect.html' && !target.closest('.mode-grid')) return;
    let selected = target.dataset.sessionMode;
    if (!selected && target.tagName === 'A') {
      const url = new URL(target.href, location.href);
      if (url.origin === location.origin) selected = url.pathname === '/share.html' ? 'share' : url.pathname === '/mic.html' ? 'mic' : url.pathname === '/connect.html' ? url.searchParams.get('mode') : null;
    }
    if (!names[selected] || window.CineWallDeviceSupport?.isPhone && selected !== 'mic') return;
    if (selected === 'mic' && location.pathname === '/mic.html' && target.matches('#phoneRole,#speakerRole')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    // Every landing card offers both choices, including for returning users.
    if (isHome || target.closest('.mode-grid') || !session.room) { location.href = entryLink(selected); return; }
    session.ready.then(info => info?.admin ? session.switchMode(selected) : info ? session.navigate(info) : location.assign(entryLink(selected))).catch(error => { show(selected); message(error.message); });
  }, true);
  window.addEventListener('cinewall-room-error', event => { for (const media of document.querySelectorAll('video,audio')) media.pause(); show(pageMode()); message(event.detail); });
  if (isEntry || isRoomPage && !session.room) { show(pageMode()); if (isEntry && new URL(location.href).searchParams.has('join')) showJoin(); }
  if (!session.room || !isRoomPage) return;
  session.ready.then(info => {
    if (!info) return;
    document.body.dataset.roomRole = info.admin ? 'admin' : 'guest';
    const bar = document.createElement('section'); bar.className = 'room-identity'; bar.setAttribute('aria-label', 'Room connection');
    const identity = document.createElement('div'); identity.className = 'room-code-block';
    const label = document.createElement('span'); label.className = 'room-code-label'; label.textContent = 'Room code';
    const copy = document.createElement('button'); copy.className = 'room-code-copy'; copy.type = 'button'; copy.setAttribute('aria-label', 'Copy room ID');
    const code = document.createElement('strong'); code.textContent = info.code;
    const copyLabel = document.createElement('span'); copyLabel.textContent = 'Copy';
    copy.append(code, copyLabel); identity.append(label, copy);
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(info.code); copyLabel.textContent = 'Copied'; }
      catch { const range = document.createRange(); range.selectNodeContents(code); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); copyLabel.textContent = 'Select & copy'; }
      setTimeout(() => copyLabel.textContent = 'Copy', 1800);
    });
    const controls = document.createElement('div'); controls.className = 'room-connection-controls';
    const note = document.createElement('p'); note.className = 'room-connection-note'; note.setAttribute('role', 'status');
    let modeSelect;
    const updateNote = current => { if (modeSelect) modeSelect.value = current.mode; note.textContent = current.waiting ? `Connected · waiting for a place in ${names[current.mode]}` : current.admin ? 'Guests follow your mode switches automatically.' : `Connected to ${names[current.mode]}${current.role === 'phone' ? ' · Phone mic' : ` · ${current.mode === 'audio' || current.mode === 'mic' ? 'Speaker' : 'Screen'} ${current.screen}`}`; };
    updateNote(info); window.addEventListener('cinewall-room-updated', event => updateNote(event.detail));
    if (info.admin) {
      const field = document.createElement('label'); field.className = 'room-mode-field'; field.textContent = 'Mode';
      const select = document.createElement('select'); modeSelect = select; select.setAttribute('aria-label', 'Room mode');
      for (const [value, name] of Object.entries(names)) { const option = document.createElement('option'); option.value = value; option.textContent = name; select.append(option); }
      select.value = info.mode; field.append(select); controls.append(field);
      select.addEventListener('change', async () => { select.disabled = true; try { await session.switchMode(select.value); } catch (error) { select.value = info.mode; select.disabled = false; note.textContent = error.message; } });
    }
    const join = document.createElement('a'); join.className = 'button subtle room-join-link'; join.href = entryLink(info.mode, true); join.textContent = 'Join room'; controls.append(join);
    const options = document.createElement('details'); options.className = 'room-options';
    const summary = document.createElement('summary'); summary.textContent = 'More'; summary.setAttribute('aria-label', 'Room options');
    const menu = document.createElement('div'); menu.className = 'room-options-menu';
    const newRoom = document.createElement('a'); newRoom.href = entryLink(info.mode); newRoom.textContent = 'Create another room'; menu.append(newRoom);
    if (!info.admin) {
      const leave = document.createElement('button'); leave.type = 'button'; leave.textContent = 'Leave room';
      leave.addEventListener('click', async () => { leave.disabled = true; try { const response = await fetch(session.link('/api/rooms/leave'), { method: 'POST' }); if (!response.ok) throw new Error(); session.storage.remove(`cinewall-room-${info.room}`); location.href = '/'; } catch { leave.disabled = false; leave.textContent = 'Try leaving again'; } }); menu.append(leave);
    }
    if (info.admin && info.recoveryKey) {
      const details = document.createElement('details'); details.className = 'room-recovery';
      const title = document.createElement('summary'); title.textContent = 'Admin recovery key';
      const key = document.createElement('code'); key.textContent = info.recoveryKey;
      const help = document.createElement('small'); help.textContent = 'Save privately. This key restores admin access.';
      details.append(title, key, help); menu.append(details);
    }
    options.append(summary, menu); controls.append(options); bar.append(identity, controls, note);
    const header = document.querySelector('main > header'); if (header) header.insertAdjacentElement('afterend', bar); else document.querySelector('main')?.prepend(bar);
    if (!info.admin && info.mode === 'mic') document.querySelector('#addLaptop')?.setAttribute('hidden', '');
  }).catch(() => {});
})();
