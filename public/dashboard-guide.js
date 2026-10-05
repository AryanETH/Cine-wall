(() => {
  const $ = (selector) => document.querySelector(selector);
  const launch = $('#openDashboardGuide');
  const backdrop = $('#guideBackdrop');
  const card = $('#dashboardGuide');
  const title = $('#guideTitle');
  const copy = $('#guideCopy');
  const progress = $('#guideProgress');
  const back = $('#guideBack');
  const next = $('#guideNext');
  const skip = $('#guideSkip');
  const storagePrefix = 'cinewall-dashboard-guide-v1:';
  let steps = [];
  let index = 0;
  let activeMode = 'video';
  let activeTarget = null;
  let previousFocus = null;
  let positionFrame = 0;

  function visible(selector) {
    const element = $(selector);
    return element && !element.closest('[hidden]') && element.getClientRects().length ? element : null;
  }

  function buildSteps(mode) {
    const speaker = mode === 'audio';
    const result = [{
      target: '#screens',
      title: speaker ? 'Connect your speakers' : 'Connect your screens',
      copy: speaker
        ? 'Open each numbered link on the laptop you want to use as a speaker.'
        : 'Open each numbered link on its matching laptop. This laptop is Screen 1.'
    }];

    if (visible('#viewerSource')) {
      result.push({ target: '#viewerSource', title: 'Open your screen', copy: 'Another laptop is in control. Choose your screen and open it here.' });
    } else if (mode === 'youtube') {
      result.push({ target: '#youtubeSourceForm', title: 'Add a YouTube video', copy: 'Paste a YouTube link, then select Load video.' });
    } else {
      result.push({
        target: '#fileSourceButton',
        title: speaker ? 'Add your songs' : mode === 'presentation' ? 'Add your slides' : 'Add your video',
        copy: speaker ? 'Choose audio files from this laptop. You can add up to 10 songs.'
          : mode === 'presentation' ? 'Choose the document or slides you want to show.'
            : 'Choose a video from this laptop.'
      });
      if (mode === 'video' || mode === 'audio') {
        result.push({ target: '#sharingPanel', title: 'Choose how to share', copy: 'Instant shares over the same hotspot or Wi-Fi. Upload sends a copy first.' });
      }
      if (speaker) {
        result.push({ target: '#audioQueue', title: 'Set the song order', copy: 'Drag songs to change the order. The next song starts automatically.' });
      }
    }

    result.push({
      target: '#player',
      title: mode === 'presentation' ? 'Change pages' : 'Control playback',
      copy: mode === 'presentation' ? 'Use the arrows to change pages on every screen.'
        : 'Play, pause, skip, and adjust the volume here.'
    });
    return result.filter((step) => visible(step.target));
  }

  function positionCard() {
    if (card.hidden || !activeTarget) return;
    const target = activeTarget.getBoundingClientRect();
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const margin = 16;
    let left = Math.max(margin, Math.min(target.left, window.innerWidth - width - margin));
    let top = target.bottom + 14;
    if (top + height > window.innerHeight - margin) top = target.top - height - 14;
    if (top < margin) top = Math.max(margin, window.innerHeight - height - margin);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function schedulePosition() {
    if (positionFrame) cancelAnimationFrame(positionFrame);
    positionFrame = requestAnimationFrame(() => { positionFrame = 0; positionCard(); });
  }

  function showStep() {
    activeTarget?.classList.remove('guide-focus');
    const step = steps[index];
    activeTarget = $(step.target);
    activeTarget.classList.add('guide-focus');
    title.textContent = step.title;
    copy.textContent = step.copy;
    progress.textContent = `${index + 1} of ${steps.length}`;
    back.disabled = index === 0;
    next.textContent = index === steps.length - 1 ? 'Done' : 'Next';
    activeTarget.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    schedulePosition();
    setTimeout(schedulePosition, 350);
    next.focus();
  }

  function saveSeen() {
    try { localStorage.setItem(storagePrefix + activeMode, '1'); } catch { /* Storage may be unavailable. */ }
  }

  function close() {
    if (card.hidden) return;
    saveSeen();
    activeTarget?.classList.remove('guide-focus');
    activeTarget = null;
    card.hidden = true;
    backdrop.hidden = true;
    document.body.classList.remove('guide-open');
    card.style.left = '';
    card.style.top = '';
    if (previousFocus?.isConnected) previousFocus.focus();
    else launch.focus();
  }

  function start() {
    if (!card.hidden) return;
    activeMode = document.body.dataset.sessionMode || 'video';
    steps = buildSteps(activeMode);
    if (!steps.length) return;
    index = 0;
    previousFocus = document.activeElement;
    backdrop.hidden = false;
    card.hidden = false;
    document.body.classList.add('guide-open');
    showStep();
  }

  function autoStart() {
    const mode = document.body.dataset.sessionMode || 'video';
    try { if (localStorage.getItem(storagePrefix + mode)) return; } catch { /* Continue without storage. */ }
    // A viewing laptop should not be shown admin instructions automatically.
    if (visible('#viewerSource')) return;
    setTimeout(() => {
      if (!card.hidden || visible('#viewerSource') || document.body.dataset.sessionMode !== mode) return;
      try { if (localStorage.getItem(storagePrefix + mode)) return; } catch { /* Continue without storage. */ }
      start();
    }, 450);
  }

  function advance() {
    if (index === steps.length - 1) close();
    else { index += 1; showStep(); }
  }

  launch.addEventListener('click', start);
  skip.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  back.addEventListener('click', () => { if (index > 0) { index -= 1; showStep(); } });
  next.addEventListener('click', advance);
  document.addEventListener('keydown', (event) => {
    if (card.hidden) return;
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); advance(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); if (index > 0) { index -= 1; showStep(); } }
    else if (event.key === 'Tab') {
      const controls = [skip, back, next].filter((button) => !button.disabled);
      const position = controls.indexOf(document.activeElement);
      if (!event.shiftKey && position < 0) { event.preventDefault(); controls[0].focus(); }
      else if (event.shiftKey && position <= 0) { event.preventDefault(); controls.at(-1).focus(); }
      else if (!event.shiftKey && position === controls.length - 1) { event.preventDefault(); controls[0].focus(); }
    }
  }, true);
  window.addEventListener('resize', schedulePosition);
  window.addEventListener('scroll', schedulePosition, true);

  window.CineWallGuide = { start, autoStart, close, isOpen: () => !card.hidden };
})();
