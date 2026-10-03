'use strict';

(() => {
  const apiUrl = 'https://www.youtube.com/iframe_api';
  let apiPromise = null;

  function loadApi() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      const previousReady = window.onYouTubeIframeAPIReady;
      const timeout = setTimeout(() => reject(new Error('The YouTube player took too long to load. Check this Device’s internet connection.')), 8000);
      window.onYouTubeIframeAPIReady = () => {
        clearTimeout(timeout);
        if (typeof previousReady === 'function') previousReady();
        resolve(window.YT);
      };
      const script = document.createElement('script');
      script.src = apiUrl;
      script.async = true;
      script.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('The YouTube Player API could not load. Check this Device’s internet connection.'));
      });
      document.head.appendChild(script);
    }).catch((error) => {
      apiPromise = null;
      throw error;
    });
    return apiPromise;
  }

  class YouTubeProvider {
    constructor(elementId, callbacks = {}) {
      this.elementId = elementId;
      this.callbacks = callbacks;
      this.player = null;
      this.ready = false;
      this.pendingVideo = null;
      this.videoId = '';
      this.state = -1;
      this.lastError = null;
      this.readyTimer = null;
      this.destroyed = false;
    }

    async cue(videoId, startSeconds = 0) {
      this.lastError = null;
      this.pendingVideo = { videoId, startSeconds: Math.max(0, Number(startSeconds) || 0) };
      this.videoId = videoId;
      const YT = await loadApi();
      if (this.destroyed) return;
      if (!this.player) {
        this.readyTimer = setTimeout(() => {
          if (!this.ready) this.callbacks.onError?.(-1, this);
        }, 8000);
        // Construct the iframe ourselves so every Device delegates autoplay
        // and sends an explicit referrer, including private LAN HTTP origins.
        const frame = document.createElement('iframe');
        frame.id = this.elementId;
        frame.title = 'YouTube video player';
        frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        const params = new URLSearchParams({ enablejsapi: '1', origin: location.origin,
          autoplay: '0', mute: '1', controls: '0', playsinline: '1', rel: '0' });
        frame.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params}`;
        document.getElementById(this.elementId).replaceWith(frame);
        this.player = new YT.Player(frame, {
          width: '100%',
          height: '100%',
          videoId,
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            playsinline: 1,
            rel: 0,
            origin: window.location.origin,
            widget_referrer: window.location.href,
          },
          events: {
            onReady: (event) => this.onReady(event),
            onStateChange: (event) => this.onStateChange(event),
            onError: (event) => this.onError(event),
            onAutoplayBlocked: () => this.callbacks.onAutoplayBlocked?.(this),
          },
        });
      } else if (this.ready) {
        this.player.cueVideoById({ videoId, startSeconds: this.pendingVideo.startSeconds });
      }
    }

    onReady(event) {
      if (this.destroyed) return;
      clearTimeout(this.readyTimer);
      this.ready = true;
      if (this.pendingVideo) event.target.cueVideoById(this.pendingVideo);
      this.callbacks.onReady?.(this);
    }

    onStateChange(event) {
      if (this.destroyed) return;
      this.state = Number(event.data);
      if ([0, 1, 2, 3, 5].includes(this.state)) this.lastError = null;
      this.callbacks.onStateChange?.(this.state, this);
    }

    onError(event) {
      if (this.destroyed) return;
      clearTimeout(this.readyTimer);
      this.lastError = Number(event.data);
      this.callbacks.onError?.(this.lastError, this);
    }

    play() { if (this.ready) this.player.playVideo(); }
    pause() { if (this.ready) this.player.pauseVideo(); }
    seek(seconds, allowSeekAhead = true) { if (this.ready) this.player.seekTo(Math.max(0, Number(seconds) || 0), allowSeekAhead); }
    setVolume(value) { if (this.ready) this.player.setVolume(Math.round(Math.min(1, Math.max(0, Number(value) || 0)) * 100)); }
    setMuted(muted) {
      if (!this.ready) return;
      if (muted) this.player.mute();
      else this.player.unMute();
    }
    getCurrentTime() { return this.ready ? Number(this.player.getCurrentTime()) || 0 : 0; }
    getDuration() { return this.ready ? Number(this.player.getDuration()) || 0 : 0; }
    getState() { return this.ready ? Number(this.player.getPlayerState()) : -1; }
    getVideoData() { return this.ready ? this.player.getVideoData() || {} : {}; }
    destroy() {
      this.destroyed = true;
      clearTimeout(this.readyTimer);
      if (this.player?.destroy) this.player.destroy();
      this.player = null;
      this.ready = false;
      this.state = -1;
    }
  }

  window.CineWallYouTubeProvider = YouTubeProvider;
})();
