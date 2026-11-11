
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
    let preparedMedia = '', preparedLogo = '', logoFailed = false, reloadTimer, retried = false;
    let readyReported = '', readyRetryAt = 0;
    let playedThisRun = false;

    const position = () => slot.position + (slot.startedAt === null ? 0 : Math.max(0, now() - slot.startedAt) / 1000);

    function prepare(media, image) {
      const videoUrl = media ? link(media) : '';
      const logoUrl = image ? link(image) : '';
      if (preparedMedia !== videoUrl) {
        preparedMedia = videoUrl;
        clearTimeout(reloadTimer);
        retried = false;
        video.pause();
        if (videoUrl) video.src = videoUrl;
        else video.removeAttribute('src');
        video.load();
      }
      if (preparedLogo !== logoUrl) {
        preparedLogo = logoUrl;
        logoFailed = false;
        if (logoUrl) logo.src = logoUrl;
        else logo.removeAttribute('src');
      }
    }

    function confirmReady() {
      if (!slot.loading || failed || video.seeking || video.readyState < 3 || readyReported === slot.id || now() < readyRetryAt) return;
      const id = slot.id;
      readyReported = id;
      void request('/api/ad-break/ready?ad=' + encodeURIComponent(id) + '&screen=' + display.screen).catch(() => {
        if (slot?.id !== id) return;
        readyReported = '';
        readyRetryAt = now() + 800;
      });
    }

    function reportEvent(event) {
      if (!report || reported.has(event)) return;
      const pending = reported;
      pending.add(event);
      void report('/api/ad-break/event?ad=' + encodeURIComponent(slot.id) + '&event=' + event)
        .catch(() => pending.delete(event));
    }

    function samplePlayback() {
      if (!slot || !playedThisRun || failed || overlay.hidden || document.visibilityState === 'hidden' || video.seeking || !video.played?.length) return;
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
      confirmReady();
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
      pause.hidden = !display.controller || slot.loading === true;
      pause.textContent = paused ? 'Resume ad' : 'Pause ad';
      countdown.textContent = failed ? 'Ad unavailable. Waiting for the room…'
        : slot.loading ? 'Loading ad…'
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
          if (video.currentTime > 0) video.currentTime = 0;
          overlay.hidden = true;
          progressFill.style.transform = 'scaleX(0)';
          logo.hidden = true;
          if (visit) { visit.hidden = true; visit.removeAttribute('href'); }
          localMuted = autoplayMuted = false;
        }
        const preload = options.ready ? options.preload : null;
        prepare(preload?.media, preload?.logo);
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
        readyReported = '';
        readyRetryAt = 0;
        playedThisRun = false;
        video.pause();
        if (video.currentTime > 0) video.currentTime = 0;
        const fallback = '/api/ad-break/media?ad=' + encodeURIComponent(slot.id);
        const media = slot.media || fallback;
        const alreadyPrepared = preparedMedia === link(media);
        prepare(media, slot.logo);
        if (alreadyPrepared && video.error && retried) {
          retried = false;
          clearTimeout(reloadTimer);
          video.load();
        }
        badge.textContent = 'Ad ' + slot.number + ' of ' + slot.total;
        title.textContent = slot.title;
        if (visit) {
          visit.hidden = true;
          if (slot.clickUrl) visit.href = slot.clickUrl;
          else visit.removeAttribute('href');
        }
        progressFill.style.transform = 'scaleX(0)';
        
        logo.hidden = !slot.logo || logoFailed;
        
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
    video.addEventListener('playing', () => { if (slot) playedThisRun = true; });
    video.addEventListener('timeupdate', samplePlayback);
    video.addEventListener('ended', samplePlayback);
    logo.addEventListener('error', () => { logoFailed = true; logo.hidden = true; });
    visit?.addEventListener('click', () => { if (slot && !visit.hidden) reportEvent('click'); });
    video.addEventListener('error', () => {
      if (!preparedMedia || failed) return;
      if (!retried) {
        retried = true;
        reloadTimer = setTimeout(() => video.load(), 450);
        return;
      }
      if (!slot) return;
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

