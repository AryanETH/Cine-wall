// Local video/audio only. YouTube's cross-origin player cannot be routed here.
(function (root) {
  const roles = {
    2: ['Left', 'Right'],
    3: ['Left', 'Centre', 'Right'],
    4: ['Left', 'Centre-left', 'Centre-right', 'Right'],
    5: ['Left', 'Centre-left', 'Centre', 'Centre-right', 'Right'],
  };

  function roleForScreen(count, screen) {
    return roles[count]?.[screen - 1] || 'Full sound';
  }

  function mixForScreen(count, screen) {
    if (!Number.isInteger(count) || count < 2 || !Number.isInteger(screen) || screen < 1 || screen > count) {
      return { left: 0.5, right: 0.5, gain: 1 };
    }
    const right = (screen - 1) / (count - 1);
    return { left: 1 - right, right, gain: Math.sqrt(2 / count) };
  }

  function createRouter(media) {
    let context = null;
    let source = null;
    let graphReady = false;
    let graphFailed = false;
    let appliedKey = '';
    let personalGain = null;
    let leftGain = null;
    let rightGain = null;
    let rightAnalyser = null;
    let samples = null;
    let checkTimer = null;
    let assetVersion = '';
    let stereoDetected = false;
    let mode = 'personal';
    let count = 1;
    let screen = 1;

    function ensure() {
      if (graphReady) return true;
      if (graphFailed) return false;
      const AudioContextClass = root.AudioContext || root.webkitAudioContext;
      if (!AudioContextClass) return false;
      try {
        context = new AudioContextClass({ latencyHint: 'interactive' });
        source = context.createMediaElementSource(media);
        personalGain = context.createGain();
        leftGain = context.createGain();
        rightGain = context.createGain();
        rightAnalyser = context.createAnalyser();
        rightAnalyser.fftSize = 512;
        samples = new Float32Array(rightAnalyser.fftSize);
        const splitter = context.createChannelSplitter(2);
        personalGain.gain.value = 1;
        leftGain.gain.value = 0;
        rightGain.gain.value = 0;
        source.connect(personalGain);
        personalGain.connect(context.destination);
        source.connect(splitter);
        splitter.connect(leftGain, 0);
        splitter.connect(rightAnalyser, 1);
        rightAnalyser.connect(rightGain);
        leftGain.connect(context.destination);
        rightGain.connect(context.destination);
        graphReady = true;
        return true;
      } catch {
        graphFailed = true;
        // A media element can only be captured once. Keep its original sound
        // audible if a later graph step fails.
        try { source?.connect(context.destination); } catch {}
        return false;
      }
    }

    function setGain(node, value) {
      node.gain.setTargetAtTime(value, context.currentTime, 0.015);
    }

    function applyGains() {
      if (!graphReady) return;
      const spatial = mode === '3d' && count >= 2;
      setGain(personalGain, spatial ? 0 : 1);
      if (!spatial) { setGain(leftGain, 0); setGain(rightGain, 0); return; }
      const mix = mixForScreen(count, screen);
      // Until a real right channel is heard, treat the input as mono. This
      // prevents the rightmost laptop from going silent on mono recordings.
      setGain(leftGain, (mix.left + (stereoDetected ? 0 : mix.right)) * mix.gain);
      setGain(rightGain, stereoDetected ? mix.right * mix.gain : 0);
    }

    function watchForStereo() {
      if (checkTimer || !context || stereoDetected) return;
      checkTimer = setInterval(() => {
        if (mode !== '3d' || stereoDetected || media.paused || media.ended || context.state !== 'running') return;
        rightAnalyser.getFloatTimeDomainData(samples);
        if (samples.some((sample) => Math.abs(sample) > 0.002)) {
          stereoDetected = true;
          applyGains();
          clearInterval(checkTimer);
          checkTimer = null;
        }
      }, 250);
    }

    function stopWatching() {
      if (checkTimer) clearInterval(checkTimer);
      checkTimer = null;
    }

    function set(nextMode, nextCount, nextScreen, nextVersion) {
      mode = nextMode === '3d' ? '3d' : 'personal';
      count = Math.min(5, Math.max(1, Number(nextCount) || 1));
      screen = Math.min(count, Math.max(1, Number(nextScreen) || 1));
      if (nextVersion !== assetVersion) { assetVersion = nextVersion || ''; stereoDetected = false; }
      const key = `${mode}:${count}:${screen}:${assetVersion}`;
      if (key === appliedKey) return !graphFailed;
      if (mode === '3d' && count >= 2 && !ensure()) return false;
      if (graphFailed) return false;
      appliedKey = key;
      applyGains();
      if (mode === '3d' && count >= 2) watchForStereo();
      else stopWatching();
      return true;
    }

    async function resume() {
      if (!context || context.state === 'running') return true;
      try { await context.resume(); return context.state === 'running'; } catch { return false; }
    }

    return { set, resume, state: () => context?.state || 'native' };
  }

  const api = { roleForScreen, mixForScreen, createRouter };
  root.CineWallAudioLayout = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
