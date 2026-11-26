'use strict';
window.CineWallPlayerFeatures = {
  create({ video, link, wake, command, onAudioBlocked = () => {} }) {
    const $ = selector => document.querySelector(selector);
    const menu = $('#playerFeatureMenu'), status = $('#playerFeatureStatus');
    const alternate = $('#playerAlternateAudio'), layer = $('#playerCaptionsLayer'), text = $('#playerCaptionText');
    if (!menu || !alternate || !layer) return null;
    const audioSelect = $('#playerAudioTrack'), captionSelect = $('#playerCaptionTrack');
    let state, version = '', cues = [], captionKey = '', audioKey = '', editable = false, ready = false;
    let moving = false, dragging = false, requestVersion = 0, queued = Promise.resolve();
    let captionController, nativeChoice = '', captionRetryAt = 0;
    let automaticCaptions = '';
    let captionLayout = '';
    let playRequest = false, output, blockedAudio = false, failedAudio = '', automaticAudio = '', warmedAudio = '', warmRetryAt = 0;
    const router = window.CineWallAudioLayout?.createRouter(alternate);
    function notify(message = '') { status.textContent = message; }
    function endpoint(path) { return link('/api/player/' + path + (path.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(version)); }
    async function json(url, init) {
      const response = await fetch(url, init), body = await response.json();
      if (!response.ok) throw Error(body.error || 'The player setting could not be changed.');
      return body;
    }
    function option(select, value, label, disabled = false) {
      const node = document.createElement('option');
      node.value = value; node.textContent = label; node.disabled = disabled; select.append(node);
    }
    function trackLabel(track) {
      let label = track.label;
      if (/^[a-z]{2,3}$/i.test(label) && label !== 'und') {
        try { label = new Intl.DisplayNames(['en'], { type: 'language' }).of(label); } catch {}
      }
      return label + ' · ' + (track.codec || 'audio').toUpperCase();
    }
    async function save(patch) {
      const selectedVersion = version;
      const update = async () => {
        if (selectedVersion !== version) return;
        const result = await json(endpoint('options'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...patch, ...(typeof patch.audio === 'number' ? { position: video.currentTime || 0 } : {}) }) });
        if (selectedVersion === version) state = { ...state, playerOptions: result };
        sync(state, ready, editable);
      };
      const pending = queued.catch(() => {}).then(update);
      queued = pending;
      return pending;
    }
    async function action(callback, control) {
      wake(); notify('Preparing…');
      if (control) control.disabled = true;
      try { await callback(); notify(); }
      catch (error) { notify(error.message); }
      finally { if (control) control.disabled = !editable; }
    }
    async function list() {
      if (!version || state?.sessionMode !== 'video') return;
      const generation = ++requestVersion;
      audioSelect.replaceChildren(); captionSelect.replaceChildren();
      option(audioSelect, '', 'Original audio'); option(captionSelect, 'off', 'Off');
      const native = Array.from(video.audioTracks || []);
      for (let n = 0; n < native.length; n++) option(audioSelect, 'native:' + n, native[n].label || native[n].language || 'Track ' + (n + 1));
      let hint = 'Reading video tracks…';
      $('#playerTrackHint').textContent = hint;
      let firstAudio, firstCaption;
      {
        try {
          const tracks = await json(endpoint('tracks'));
          if (generation !== requestVersion) return;
          for (const track of tracks.audio) option(audioSelect, String(track.id), trackLabel(track));
          firstAudio = tracks.audio[0];
          firstCaption = tracks.captions.find(track => track.supported);
          for (const track of tracks.captions) option(captionSelect, String(track.id), track.label + (track.supported ? '' : ' (image subtitles)'), !track.supported);
          hint = tracks.audio.length ? '' : 'This video has no embedded audio tracks.';
          $('#playerCaptionHint').textContent = firstCaption ? 'Embedded captions available.' : 'No embedded captions. Add an SRT / VTT file.';
        } catch (error) { hint = error.message; }
      }
      if (generation !== requestVersion) return;
      if (state.playerOptions?.captions === 'uploaded') option(captionSelect, 'uploaded', 'Uploaded captions');
      $('#playerTrackHint').textContent = hint;
      audioSelect.value = state.playerOptions?.audio ?? '';
      captionSelect.value = state.playerOptions?.captions || 'off';
      if (editable && state.playerOptions?.audio == null && automaticAudio !== version && firstAudio && ['ac3', 'eac3', 'dts', 'truehd'].includes(firstAudio.codec)) {
        // These common movie soundtracks need a browser-compatible audio copy.
        // The original video is still played directly without re-encoding.
        automaticAudio = version;
        await action(() => save({ audio: firstAudio.id }), audioSelect);
      }
      if (editable && firstCaption && automaticCaptions !== version && state.playerOptions?.captions === 'off') {
        automaticCaptions = version;
        await action(() => save({ captions: String(firstCaption.id) }), captionSelect);
      }
    }
    function place() {
      const settings = state?.playerOptions || {};
      const width = innerWidth, height = innerHeight;
      text.style.fontSize = (settings.size || 32) + 'px';
      text.style.width = (settings.width || 70) + '%';
      const bounds = text.getBoundingClientRect();
      text.style.left = (bounds.width / 2 + Math.max(0, width - bounds.width) * (settings.x ?? 50) / 100) + 'px';
      text.style.top = (bounds.height / 2 + Math.max(0, height - bounds.height) * (settings.y ?? 84) / 100) + 'px';
    }
    function paintCaptions() {
      if (!state || !ready || state.adBreak || state.sessionMode !== 'video') { layer.hidden = true; return; }
      const settings = state.playerOptions || {};
      const time = video.currentTime;
      const active = settings.captions !== 'off' ? cues.filter(c => c.start <= time && c.end > time).map(c => c.text).join('\n') : '';
      const content = active || (moving && editable ? 'Move captions' : '');
      if (text.textContent !== content) { text.textContent = content; captionLayout = ''; }
      layer.hidden = !text.textContent;
      const layout = [settings.size,settings.width,settings.x,settings.y,innerWidth,innerHeight].join(':');
      if (!layer.hidden && captionLayout !== layout) { place(); captionLayout = layout; }
    }
    function selectedAudio() {
      return typeof state?.playerOptions?.audio === 'number' && state.sessionMode === 'video' && ready && !state.adBreak;
    }
    function usesAlternateAudio() {
      return selectedAudio() && Boolean(audioKey) && !alternate.error && !blockedAudio && failedAudio !== audioKey;
    }
    function setMainAudio(setting) {
      const volume = Math.max(0, Math.min(1, Number(setting.volume) || 0));
      const muted = Boolean(setting.muted || usesAlternateAudio());
      if (video.volume !== volume) video.volume = volume;
      if (video.muted !== muted) video.muted = muted;
    }
    function syncAudio() {
      if (!state) return;
      const setting = output || state.audioSettings?.[String(window.CineWallSession?.membership?.screen || Number(new URLSearchParams(location.search).get('screen')) || 1)] || { volume: 1, muted: false };
      const selected = state.playerOptions?.audio;
      const isNative = typeof selected === 'string' && selected.startsWith('native:');
      if (isNative && nativeChoice !== selected && video.audioTracks?.length) {
        Array.from(video.audioTracks).forEach((track, n) => { track.enabled = n === Number(selected.split(':')[1]); });
        nativeChoice = selected;
      } else if (!isNative && nativeChoice && video.audioTracks?.length) {
        Array.from(video.audioTracks).forEach((track, n) => { track.enabled = n === 0; }); nativeChoice = '';
      }
      const active = selectedAudio();
      alternate.volume = Math.max(0, Math.min(1, Number(setting.volume) || 0));
      alternate.muted = Boolean(setting.muted);
      router?.set(state.audioMode || 'personal', state.screenCount, Number(new URLSearchParams(location.search).get('screen')) || 1, version);
      if (!active) {
        alternate.pause();
        if (audioKey) { audioKey = ''; alternate.removeAttribute('src'); alternate.load(); }
        setMainAudio(setting);
        return;
      }
      const windowSeconds = Number(state.playerOptions?.audioWindowSeconds) || 0;
      const start = windowSeconds ? Math.floor(video.currentTime / windowSeconds) * windowSeconds : 0;
      const key = version + ':' + selected + ':' + start;
      if (key !== audioKey) {
        audioKey = key;
        blockedAudio = false; failedAudio = '';
        alternate.src = endpoint('audio?track=' + selected + '&start=' + start); alternate.load();
      }
      setMainAudio(setting);
      if (failedAudio === audioKey || blockedAudio) return;
      const localTime = video.currentTime - start;
      if (alternate.readyState >= 1 && Math.abs(alternate.currentTime - localTime) > .14) {
        try { alternate.currentTime = localTime; } catch {}
      }
      const next = start + windowSeconds, warmKey = version + ':' + selected + ':' + next;
      if (windowSeconds && !video.paused && next < video.duration && localTime >= windowSeconds - 20 && warmedAudio !== warmKey && Date.now() >= warmRetryAt) {
        warmedAudio = warmKey;
        void fetch(endpoint('audio?track=' + selected + '&start=' + next), { method: 'HEAD' }).then(response => {
          if (!response.ok && warmedAudio === warmKey) { warmedAudio = ''; warmRetryAt = Date.now() + 5000; }
        }).catch(() => { if (warmedAudio === warmKey) { warmedAudio = ''; warmRetryAt = Date.now() + 5000; } });
      }
      alternate.playbackRate = video.playbackRate;
      if (!video.paused && !video.seeking && video.readyState >= 2 && alternate.paused && !playRequest) {
        void router?.resume();
        playRequest = true;
        alternate.play().catch(error => {
          if (error.name === 'AbortError') return;
          blockedAudio = true; setMainAudio(setting);
          notify('Click Enable sound to play the selected audio.'); onAudioBlocked();
        }).finally(() => { playRequest = false; });
      } else if (video.paused || video.seeking) alternate.pause();
    }
    async function unlockAudio() {
      blockedAudio = false;
      if (!selectedAudio() || !alternate.getAttribute('src')) return true;
      if (failedAudio === audioKey) { failedAudio = ''; alternate.load(); }
      const paused = video.paused;
      try {
        const resume = router?.resume();
        // Start while the actual click is still active; waiting for a network
        // command before play() loses the browser's sound permission.
        const playing = alternate.play();
        await playing;
        if (paused) alternate.pause();
        if (resume && !await resume) throw Error('Sound is blocked.');
        notify(); syncAudio(); return true;
      } catch (error) {
        if (error.name === 'AbortError') return true;
        blockedAudio = true; notify('Click Enable sound to play the selected audio.'); onAudioBlocked();
        syncAudio(); return false;
      }
    }
    function sync(next, isReady, canEdit) {
      if (dragging && next?.asset?.version === version) {
        next = { ...next, playerOptions: { ...next.playerOptions, x: state.playerOptions.x, y: state.playerOptions.y } };
      }
      state = next; ready = isReady; editable = canEdit;
      const nextVersion = next?.asset?.version || '';
      if (version !== nextVersion) {
        version = nextVersion; requestVersion++; captionKey = ''; cues = []; moving = false;
        layer.classList.remove('is-editing'); $('#playerCaptionMove').setAttribute('aria-pressed', 'false');
        captionController?.abort(); notify();
        if (version && ready && next.sessionMode === 'video') void list();
      }
      const isVideo = next?.sessionMode === 'video', isAudio = next?.sessionMode === 'audio';
      menu.hidden = !ready || !editable || !(isVideo || isAudio) || Boolean(next?.adBreak);
      for (const node of menu.querySelectorAll('[data-video-only],#playerCaptionsMenu,#playerAudioMenu')) node.hidden = !isVideo;
      for (const input of menu.querySelectorAll('input,select,button')) input.disabled = !editable || !next?.asset;
      for (const [id, value] of [['playerPictureFit',next?.mode || 'crop'],['playerVideoView',next?.videoView || 'normal'],['playerSoundMode',next?.audioMode || 'personal']]) {
        const control = $('#' + id);
        if (control && document.activeElement !== control) control.value = value;
      }
      if (!next?.asset) $('#playerCaptionHint').textContent = 'Load a video from the dashboard first.';
      const settings = state?.playerOptions || {};
      for (const [name, id] of Object.entries({ size: 'Size', width: 'Width', x: 'X', y: 'Y' })) {
        const input = $('#playerCaption' + id);
        if (document.activeElement !== input && !dragging) input.value = settings[name] ?? ({ size:32,width:70,x:50,y:84 }[name]);
      }
      if (settings.captions === 'uploaded' && !Array.from(captionSelect.options).some(o => o.value === 'uploaded')) option(captionSelect, 'uploaded', 'Uploaded captions');
      if (document.activeElement !== audioSelect) audioSelect.value = settings.audio ?? '';
      if (document.activeElement !== captionSelect) captionSelect.value = settings.captions || 'off';
      const key = version + ':' + (settings.captions || 'off') + ':' + (settings.captionRevision || 0);
      if (key !== captionKey && Date.now() >= captionRetryAt) {
        captionKey = key; cues = []; captionController?.abort();
        if (settings.captions && settings.captions !== 'off') {
          captionController = new AbortController();
          json(endpoint('captions?track=' + encodeURIComponent(settings.captions)), { signal: captionController.signal }).then(data => {
            if (key === captionKey) { cues = data; captionRetryAt = 0; paintCaptions(); }
          }).catch(error => {
            if (key === captionKey && error.name !== 'AbortError') {
              captionKey = ''; captionRetryAt = Date.now() + 3000;
              notify('Captions could not load. Retrying…');
              $('#playerCaptionHint').textContent = error.message;
            }
          });
        }
      }
      syncAudio(); paintCaptions();
    }
    audioSelect.addEventListener('change', () => { void action(() => save({ audio: audioSelect.value.startsWith('native:') ? audioSelect.value : audioSelect.value === '' ? null : Number(audioSelect.value) }), audioSelect); });
    captionSelect.addEventListener('change', () => {
      automaticCaptions = version; captionKey = ''; captionRetryAt = 0;
      void action(() => save({ captions: captionSelect.value, x: 50, y: 84 }), captionSelect);
    });
    $('#playerCaptionFile').addEventListener('change', event => {
      const file = event.target.files[0];
      if (!file) return;
      void action(async () => {
        if (!/\.(srt|vtt)$/i.test(file.name) || file.size > 2 * 1024 * 1024) throw Error('Choose an SRT or WebVTT file up to 2 MB.');
        const parsed = window.CineWallCaptions.parse(await file.text());
        const selected = version;
        const data = await json(endpoint('captions'), { method: 'POST', body: file });
        if (version === selected) {
          captionKey = version + ':uploaded:' + data.captionRevision; captionRetryAt = 0; cues = parsed;
          sync({ ...state, playerOptions: data }, ready, editable); paintCaptions();
        }
        event.target.value = '';
      }, event.target);
    });
    for (const [name,id] of Object.entries({size:'Size',width:'Width',x:'X',y:'Y'})) {
      const control = $('#playerCaption' + id);
      control.addEventListener('input', () => { state = { ...state, playerOptions: { ...state.playerOptions, [name]: Number(control.value) } }; paintCaptions(); wake(); });
      control.addEventListener('change', () => { void action(() => save({ [name]:Number(control.value) })); });
    }
    $('#playerCaptionMove').addEventListener('click', () => {
      moving = !moving; layer.classList.toggle('is-editing', moving);
      $('#playerCaptionMove').setAttribute('aria-pressed', String(moving)); paintCaptions(); wake();
    });
    text.addEventListener('pointerdown', event => {
      if (!moving || !editable) return;
      dragging = true; text.setPointerCapture(event.pointerId); event.preventDefault();
    });
    text.addEventListener('pointermove', event => {
      if (!dragging) return;
      const rect = text.getBoundingClientRect();
      const x = Math.max(0, Math.min(100, (event.clientX - rect.width / 2) / Math.max(1, innerWidth - rect.width) * 100));
      const y = Math.max(0, Math.min(100, (event.clientY - rect.height / 2) / Math.max(1, innerHeight - rect.height) * 100));
      state = { ...state, playerOptions: { ...state.playerOptions, x, y } }; paintCaptions(); wake();
    });
    function finishDrag() {
      if (!dragging) return;
      dragging = false;
      void action(() => save({ x: state.playerOptions.x, y: state.playerOptions.y }));
    }
    text.addEventListener('pointerup', finishDrag); text.addEventListener('pointercancel', finishDrag);
    text.addEventListener('keydown', event => {
      if (!moving || !editable || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const horizontal = ['ArrowLeft','ArrowRight'].includes(event.key), key = horizontal ? 'x' : 'y';
      const delta = ['ArrowLeft','ArrowUp'].includes(event.key) ? -2 : 2;
      void action(() => save({ [key]: Math.max(0, Math.min(100, state.playerOptions[key] + delta)) }));
    });
    const trackMenus = Array.from(menu.querySelectorAll('details'));
    for (const details of trackMenus) {
      function closeOtherMenus() { for (const other of trackMenus) if (other !== details) other.open = false; }
      details.querySelector('summary').addEventListener('click', () => { if (!details.open) closeOtherMenus(); });
      details.addEventListener('toggle', () => { if (details.open) { closeOtherMenus(); if (['playerAudioMenu','playerCaptionsMenu'].includes(details.id)) void list(); wake(); } });
    }
    for (const [id, type, key] of [['playerPictureFit','mode','mode'],['playerVideoView','video-view','videoView'],['playerSoundMode','audio-mode','audioMode']]) {
      const control = $('#' + id);
      control?.addEventListener('change', () => { void action(async () => {
        if (!editable || !command) return;
        const result = await command({ type, [key]: control.value });
        if (!result) throw Error('The player setting could not be changed.');
      }, control); });
    }
    const enable = document.createElement('button');
    enable.type = 'button'; enable.className = 'screen-control-button'; enable.innerHTML = '<span class="fi" aria-hidden="true">&#xE767;</span>';
    enable.title = 'Enable sound'; enable.setAttribute('aria-label', 'Enable sound');
    enable.addEventListener('click', () => { void unlockAudio(); });
    $('#playerAudioMenu .player-feature-panel').append(enable);
    ['play','pause','seeking','seeked','ratechange','timeupdate','volumechange'].forEach(event => video.addEventListener(event, () => { syncAudio(); paintCaptions(); }));
    video.addEventListener('loadedmetadata', () => { if (menu.querySelector('details[open]')) void list(); });
    ['loadedmetadata', 'canplay', 'playing'].forEach(event => alternate.addEventListener(event, syncAudio));
    alternate.addEventListener('error', () => {
      failedAudio = audioKey; syncAudio();
      notify('This audio track could not load. Original audio restored. Choose the track again to retry.');
    });
    window.addEventListener('resize', paintCaptions);
    document.addEventListener('fullscreenchange', paintCaptions);
    // Paint on decoded frames as well as media events. Some browser decoders
    // throttle timeupdate while the shared player is synchronizing or buffering.
    if (video.requestVideoFrameCallback) {
      const frame = () => { paintCaptions(); video.requestVideoFrameCallback(frame); };
      video.requestVideoFrameCallback(frame);
    }
    return { sync, unlockAudio, usesAlternateAudio,
      applyAudio(setting) { output = setting; if (state) syncAudio(); else setMainAudio(setting); },
      busy: () => dragging || Boolean(menu.querySelector('details[open]')) };
  },
};
