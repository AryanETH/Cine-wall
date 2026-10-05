'use strict';

// Files stay on the source laptop. Only the selected song uses the existing
// Instant/Upload path, so a playlist never uploads ten files behind your back.
(function () {
  class AudioQueue {
    constructor(options) {
      this.options = options;
      this.items = [];
      this.currentId = '';
      this.version = '';
      this.busy = false;
      this.pendingPlay = '';
      this.playRequest = false;
      this.finishedVersion = '';
      this.sequence = 0;
    }
    changed() { this.options.changed?.(this); }
    clear() {
      this.items = []; this.currentId = ''; this.version = '';
      this.pendingPlay = ''; this.finishedVersion = ''; this.changed();
    }
    async add(files) {
      if (this.busy || this.options.blocked()) return;
      const incoming = Array.from(files);
      if (!incoming.length) return;
      if (incoming.length + this.items.length > 10) {
        this.options.error('You can add up to 10 songs.'); return;
      }
      this.busy = true; this.changed();
      const accepted = [], errors = [];
      try {
        for (const file of incoming) {
          try {
            await this.options.validate(file);
            accepted.push({ id: String(++this.sequence), file });
          } catch { errors.push(file.name); }
        }
        if (this.options.blocked()) return;
        this.items.push(...accepted);
      } finally { this.busy = false; this.changed(); }
      if (errors.length) this.options.error(`Could not add ${errors.join(', ')}. Try MP3, WAV or AAC audio.`);
      if (!this.currentId && this.items.length) await this.select(this.items[0].id, false);
    }
    move(id, to) {
      if (this.busy || this.options.blocked()) return;
      const from = this.items.findIndex(item => item.id === id);
      if (from < 0 || !Number.isInteger(to) || to < 0 || to >= this.items.length || from === to) return;
      const [item] = this.items.splice(from, 1); this.items.splice(to, 0, item); this.changed();
    }
    async select(id, autoplay = true) {
      if (this.busy || this.options.blocked()) return;
      const item = this.items.find(item => item.id === id);
      if (!item) return;
      this.busy = true; this.pendingPlay = ''; this.changed();
      try {
        const state = await this.options.load(item.file);
        if (!state?.asset || state.sessionMode !== 'audio') return;
        this.currentId = item.id; this.version = state.asset.version;
        this.finishedVersion = ''; this.pendingPlay = autoplay ? this.version : '';
      } catch (error) { this.options.error(error.message || 'This song could not be opened.'); }
      finally { this.busy = false; this.changed(); }
    }
    async remove(id, resume = false) {
      if (this.busy || this.options.blocked()) return;
      const index = this.items.findIndex(item => item.id === id);
      if (index < 0) return;
      const current = id === this.currentId;
      if (current) {
        this.busy = true; this.pendingPlay = ''; this.changed();
        try { if (!await this.options.removeCurrent()) return; }
        finally { this.busy = false; this.changed(); }
        this.currentId = ''; this.version = ''; this.finishedVersion = '';
      }
      this.items.splice(index, 1); this.changed();
      if (current && this.items.length) await this.select(this.items[Math.min(index, this.items.length - 1)].id, resume);
    }
    observe(state, screens) {
      if (this.busy || this.options.blocked()) return;
      if (state.sessionMode !== 'audio') { if (this.items.length) this.clear(); return; }
      if (this.version && state.asset?.version !== this.version) { this.clear(); return; }
      if (!this.version) return;
      if (this.pendingPlay === this.version && state.allReady && !this.playRequest) {
        const version = this.version;
        this.playRequest = true;
        Promise.resolve().then(() => this.options.play(version)).then(result => {
          if (result && this.pendingPlay === version) this.pendingPlay = '';
        }).catch(error => this.options.error(error.message || 'Could not start the song.'))
          .finally(() => { this.playRequest = false; this.changed(); });
      }
      const source = screens.find(screen => screen.screen === 1 && screen.assetVersion === this.version && screen.ready && !screen.error);
      if (!source?.ended || state.loop || this.pendingPlay || this.finishedVersion === this.version) return;
      this.finishedVersion = this.version;
      const index = this.items.findIndex(item => item.id === this.currentId);
      if (index >= 0 && index + 1 < this.items.length) void this.select(this.items[index + 1].id, true);
    }
  }

  function attach(options) {
    const panel = document.querySelector('#audioQueue');
    const list = document.querySelector('#audioQueueList');
    const count = document.querySelector('#audioQueueCount');
    const input = document.querySelector('#playlistFiles');
    let draggedId = '', touchDrag = null;
    const queue = new AudioQueue({ ...options, changed: () => { render(); options.changed?.(); } });
    function button(text, action, label, disabled) {
      const node = document.createElement('button'); node.type = 'button';
      node.textContent = text; node.dataset.queueAction = action;
      node.title = label; node.setAttribute('aria-label', label); node.disabled = disabled;
      return node;
    }
    function render() {
      panel.hidden = options.state().sessionMode !== 'audio' || options.locked();
      input.disabled = queue.busy || options.blocked() || queue.items.length >= 10;
      count.textContent = `${queue.items.length} / 10`;
      list.replaceChildren();
      queue.items.forEach((item, index) => {
        const disabled = queue.busy || options.blocked(), current = item.id === queue.currentId;
        const row = document.createElement('li'); row.dataset.songId = item.id;
        row.className = current ? 'audio-queue-song current' : 'audio-queue-song'; row.draggable = !disabled;
        const handle = document.createElement('span'); handle.className = 'queue-drag-handle';
        handle.textContent = '⠿'; handle.title = 'Drag to move song'; handle.setAttribute('aria-hidden', 'true');
        const number = document.createElement('span'); number.className = 'queue-song-number'; number.textContent = String(index + 1);
        const title = button(item.file.name.replace(/\.[^.]+$/, ''), 'select', `Play ${item.file.name}`, disabled);
        title.className = 'queue-song-title'; title.setAttribute('aria-current', String(current));
        row.append(handle, number, title,
          button('↑', 'up', 'Move song up', disabled || index === 0),
          button('↓', 'down', 'Move song down', disabled || index === queue.items.length - 1),
          button('×', 'remove', `Remove ${item.file.name}`, disabled));
        list.append(row);
      });
    }
    list.addEventListener('click', event => {
      const action = event.target.closest('[data-queue-action]'), row = action?.closest('[data-song-id]');
      if (!row || action.disabled) return;
      const id = row.dataset.songId, index = queue.items.findIndex(item => item.id === id);
      if (action.dataset.queueAction === 'select') void queue.select(id);
      else if (action.dataset.queueAction === 'remove') void queue.remove(id, options.state().playing);
      else queue.move(id, index + (action.dataset.queueAction === 'up' ? -1 : 1));
    });
    list.addEventListener('dragstart', event => {
      if (queue.busy || options.blocked()) { event.preventDefault(); return; }
      draggedId = event.target.closest('[data-song-id]')?.dataset.songId || '';
      event.dataTransfer.setData('text/x-cinewall-song', draggedId); event.dataTransfer.effectAllowed = 'move';
      event.stopPropagation();
    });
    list.addEventListener('dragover', event => {
      if (!draggedId) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
    });
    list.addEventListener('drop', event => {
      if (!draggedId) return; event.preventDefault(); event.stopPropagation();
      const row = event.target.closest('[data-song-id]');
      if (row) queue.move(draggedId, queue.items.findIndex(item => item.id === row.dataset.songId));
      draggedId = '';
    });
    list.addEventListener('dragend', () => { draggedId = ''; });
    // Touch browsers do not consistently support HTML drag-and-drop. The grip
    // uses pointer capture there; arrow buttons also work with a keyboard.
    list.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' || !event.target.closest('.queue-drag-handle') || queue.busy || options.blocked()) return;
      const row = event.target.closest('[data-song-id]');
      touchDrag = { id: row.dataset.songId, pointer: event.pointerId, target: row.dataset.songId };
      list.setPointerCapture(event.pointerId); row.classList.add('dragging'); event.preventDefault();
    });
    list.addEventListener('pointermove', event => {
      if (!touchDrag || touchDrag.pointer !== event.pointerId) return;
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-song-id]');
      if (row && list.contains(row)) touchDrag.target = row.dataset.songId;
    });
    list.addEventListener('pointerup', event => {
      if (!touchDrag || touchDrag.pointer !== event.pointerId) return;
      const drag = touchDrag; touchDrag = null;
      queue.move(drag.id, queue.items.findIndex(item => item.id === drag.target)); render();
    });
    list.addEventListener('pointercancel', () => { touchDrag = null; render(); });
    return { queue, render };
  }
  const api = { AudioQueue, attach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.CineWallAudioQueue = api;
})();
