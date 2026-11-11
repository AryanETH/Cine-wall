
'use strict';

window.CineWallAds = {
  create({ now, link, request, report, togglePlayback }) {
    const overlay = document.querySelector('#wallAd');
    const video = document.querySelector('#wallAdVideo');
    const stage = document.querySelector('#wallAdStage');
    const badge = document.querySelector('#wallAdBadge');
    const title = document.querySelector('#wallAdTitle');
    const countdown = document.querySelector('#wallAdCountdown');
    const skip = document.querySelector('#wallAdSkip');
    const mute = document.querySelector('#wallAdMute');
    const pause = document.querySelector('#wallAdPause');
    const progressFill = document.querySelector('#wallAdProgressFill');
    const logo = document.querySelector('#wallAdLogo');
    const visit = document.querySelector('#wallAdVisit');
    let reported = new Set();
    let slot = null, display, timer, playingRequest, skipRequest, localMuted = false, autoplayMuted = false, failed = false;

    const position = () => slot.position + (slot.startedAt === null ? 0 : Math.max(0, now() - slot.startedAt) / 1000);

    function reportEvent(event) {
      if (!report || reported.has(event)) return;
      const pending = reported;
      pending.add(event);
      void report('/api/ad-break/event?ad=' + encodeURIComponent(slot.id) + '&event=' + event)
        .catch(() => pending.delete(event));
    }

    function samplePlayback() {
      if (!slot || failed || overlay.hidden || document.visibilityState === 'hidden' || video.seeking || !video.played?.length) return;
      const playhead = Math.min(position(), video.currentTime, video.played.end(video.played.length - 1));
      if (playhead < .04) return;
      if (visit && slot.clickUrl) visit.hidden = false;
      const remaining = slot.duration - playhead;
      if (remaining <= Math.min(.25, slot.duration * .08)) {
        reportEvent('completed');
        return;
      }
      const fraction = playhead / slot.duration;
      const milestone = fraction >= .75 ? 'q75' : fraction >= .5 ? 'q50' : fraction >= .25 ? 'q25' : 'impression';
      reportEvent(milestone);
    }
    
    function refreshAudio() {
      if (!slot) return;
      video.volume = display.volume;
      video.muted = display.screen !== 1 || display.muted || localMuted || autoplayMuted;
      mute.hidden = display.screen !== 1 || display.muted;
      mute.textContent = video.muted ? 'Enable ad sound' : 'Mute ad';
    }

    function tryPlay() {
      if (!video.paused || playingRequest) return;
      const id = slot.id;
      playingRequest = Promise.resolve().then(() => {
        if (slot?.id === id) return video.play();
      }).catch(error => {
        if (slot?.id !== id || error.name !== 'NotAllowedError' || video.muted) return;
        autoplayMuted = true;
        refreshAudio();
        return video.play().catch(() => {});
      }).finally(() => { if (slot?.id === id) playingRequest = null; });
    }

    function tick() {
      if (!slot) return;
      samplePlayback();
      const elapsed = Math.min(slot.duration, position());
      const waiting = slot.startedAt !== null && now() < slot.startedAt;
      const paused = slot.startedAt === null;
      const remaining = Math.max(0, Math.ceil(slot.duration - elapsed));
      const untilSkip = slot.skipAfter === null ? null : Math.max(0, Math.ceil(slot.skipAfter - elapsed));
      const canSkip = untilSkip === 0 && !waiting && !paused;
      
      // Update progress bar
      const progress = Math.min(1, Math.max(0, elapsed / slot.duration));
      progressFill.style.transform = 'scaleX(' + progress + ')';
      
      skip.hidden = !canSkip;
      skip.disabled = skipRequest === slot.id;
      pause.hidden = !display.controller;
      pause.textContent = paused ? 'Resume ad' : 'Pause ad';
      countdown.textContent = failed ? 'Ad unavailable. Waiting for the room…'
        : paused ? 'Ad paused'
        : waiting ? 'Ad starting…'
        : untilSkip > 0 ? 'Skip in ' + untilSkip + 's' : remaining + 's remaining';

      if (failed || waiting || paused || elapsed >= slot.duration) video.pause();
      if (failed || waiting || video.ended || video.readyState < 1 || elapsed >= slot.duration) return;
      const drift = elapsed - video.currentTime;
      if (!video.seeking && Math.abs(drift) > (video.paused ? .15 : .35)) video.currentTime = Math.min(elapsed, Math.max(0, video.duration - .03));
      video.playbackRate = Math.abs(drift) > .08 && Math.abs(drift) < .35 ? (drift > 0 ? 1.03 : .97) : 1;
      if (!paused && video.readyState >= 2) tryPlay();
    }

    function update(next, options) {
      if (!next || !options.ready) {
        if (slot) {
          samplePlayback();
          slot = null;
          clearInterval(timer);
          video.pause();
          video.removeAttribute('src');
          video.load();
          overlay.hidden = true;
          progressFill.style.transform = 'scaleX(0)';
          logo.hidden = true;
          logo.removeAttribute('src');
          if (visit) { visit.hidden = true; visit.removeAttribute('href'); }
          localMuted = autoplayMuted = false;
        }
        return;
      }
      display = options;
      if (slot?.id !== next.id) {
        samplePlayback();
        slot = next;
        reported = new Set();
        failed = false;
        playingRequest = null;
        skipRequest = null;
        video.pause();
        video.src = link('/api/ad-break/media?ad=' + encodeURIComponent(slot.id));
        video.load();
        badge.textContent = 'Ad ' + slot.number + ' of ' + slot.total;
        title.textContent = slot.title;
        if (visit) {
          visit.hidden = true;
          if (slot.clickUrl) visit.href = slot.clickUrl;
          else visit.removeAttribute('href');
        }
        progressFill.style.transform = 'scaleX(0)';
        
        // Show logo if available
        if (slot.logo) {
          logo.src = link(slot.logo);
          logo.hidden = false;
        } else {
          logo.hidden = true;
          logo.removeAttribute('src');
        }
        
        overlay.hidden = false;
        clearInterval(timer);
        timer = setInterval(tick, 150);
      } else slot = next;
      stage.style.setProperty('--wall-screens', options.total);
      stage.style.setProperty('--screen-index', options.screen - 1);
      for (const fit of ['fit', 'crop', 'stretch']) stage.classList.toggle('mode-' + fit, fit === options.fit);
      refreshAudio();
      tick();
    }

    video.addEventListener('canplay', tick);
    video.addEventListener('timeupdate', samplePlayback);
    video.addEventListener('ended', samplePlayback);
    logo.addEventListener('error', () => { logo.hidden = true; });
    visit?.addEventListener('click', () => { if (slot && !visit.hidden) reportEvent('click'); });
    video.addEventListener('error', () => {
      if (!slot || failed) return;
      failed = true;
      tick();
      if (display.controller) {
        void request('/api/ad-break/unavailable?ad=' + encodeURIComponent(slot.id)).catch(() => {});
      }
    });
    skip.addEventListener('click', async () => {
      if (!slot || skip.hidden || skipRequest === slot.id) return;
      const id = slot.id;
      skipRequest = id;
      tick();
      try { await request('/api/ad-break/skip?ad=' + encodeURIComponent(id)); }
      catch {
        if (slot?.id === id) countdown.textContent = 'Could not skip. Please try again.';
      } finally {
        if (skipRequest === id) skipRequest = null;
        if (slot?.id === id) skip.disabled = false;
      }
    });
    mute.addEventListener('click', () => {
      if (!slot) return;
      if (video.muted) localMuted = autoplayMuted = false;
      else localMuted = true;
      refreshAudio();
      if (!video.muted && !video.paused) return;
      tick();
    });
    pause.addEventListener('click', togglePlayback);
    return { update, audio(volume, muted) {
      if (!display) return;
      Object.assign(display, { volume, muted });
      refreshAudio();
    } };
  },
};

