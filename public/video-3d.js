'use strict';
// A single decoded video supplies both eye samples; playback/audio stay native.
(() => {
  function rectangle(width, height, aspect, fit = 'fit') {
    if (fit === 'stretch') return { x: 0, y: 0, width, height };
    const scale = fit === 'crop' ? Math.max(width / aspect, height) : Math.min(width / aspect, height);
    const w = aspect * scale;
    return { x: (width - w) / 2, y: (height - scale) / 2, width: w, height: scale };
  }
  function aspectFor(width, height, source) { return width / Math.max(1, height) / (source === 'sbs-full' ? 2 : 1); }
  function create(video, canvas, { onError = () => {} } = {}) {
    if (!video || !canvas) return null;
    let config = {}, gl, program, texture, buffer, uniforms, frame, raf, failed = false, disposed = false;
    let bounds, textureWidth=0,textureHeight=0,lastMediaTime=-1,quality=1,slowFrames=0;
    const metrics={draws:0,uploads:0,allocations:0,renderMs:0};
    canvas.hidden = true;
    // Keep the native video participating in compositing beneath this overlay.
    // A fully opaque overlay can make Chromium stop presenting its video frames.
    canvas.style?.setProperty('opacity', '.999');
    function stop() {
      if (frame !== undefined) video.cancelVideoFrameCallback?.(frame);
      if (raf !== undefined) cancelAnimationFrame(raf);
      frame = raf = undefined;
    }
    function normal() { canvas.hidden = true; video.style.visibility = ''; }
    function failure() { failed = true; stop(); normal(); onError('3D view is unavailable on this device. Showing Normal.'); }
    function init() {
      // Retain the final composited frame when paused/ended, including when
      // another tab is active. No animation loop runs just to preserve it.
      gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
      if (!gl) throw new Error('WebGL unavailable');
      function shader(type, source) {
        const item = gl.createShader(type); gl.shaderSource(item, source); gl.compileShader(item);
        if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) { gl.deleteShader(item); throw new Error('Shader unavailable'); }
        return item;
      }
      const vertex = shader(gl.VERTEX_SHADER, 'attribute vec2 position; varying vec2 uv; void main(){uv=(position+1.0)*0.5; gl_Position=vec4(position,0.0,1.0);}');
      const fragment = shader(gl.FRAGMENT_SHADER, `precision mediump float;
        varying vec2 uv;
        uniform sampler2D movie;
        uniform vec2 viewport;
        uniform vec4 picture;
        uniform float offsetX;
        uniform float stereo;
        uniform float strength;
        void main(){
          vec2 p=(uv*viewport+vec2(offsetX,0.0)-picture.xy)/picture.zw;
          if(p.x<0.0||p.y<0.0||p.x>1.0||p.y>1.0){gl_FragColor=vec4(0.0,0.0,0.0,1.0);return;}
          vec2 l=p, r=p;
          if(stereo>0.5){l.x=p.x*0.5; r.x=p.x*0.5+0.5;}
          else {l.x=clamp(p.x-0.008*strength,0.0,1.0);r.x=clamp(p.x+0.008*strength,0.0,1.0);}
          vec3 left=texture2D(movie,l).rgb, right=texture2D(movie,r).rgb;
          gl_FragColor=vec4(left.r,right.g,right.b,1.0);
        }`);
      program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('3D program unavailable');
      gl.useProgram(program);
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      const attribute = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
      uniforms = Object.fromEntries(['movie','viewport','picture','offsetX','stereo','strength'].map(name => [name, gl.getUniformLocation(program, name)]));
      texture = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.uniform1i(uniforms.movie, 0);
    }
    function frameKey(){return video.webkitDecodedFrameCount>0?'frame:'+video.webkitDecodedFrameCount:Math.floor(video.currentTime*60);}
    function draw(mediaTime=frameKey()) {
      if (!config.active || failed || disposed || document.hidden || video.readyState < 2 || !video.videoWidth) return;
      const began=performance.now();
      try {
        if (!gl) init();
        if(!bounds)bounds=canvas.parentElement.getBoundingClientRect();
        const width = Math.max(1, bounds.width), height = Math.max(1, bounds.height);
        // Only render this laptop's slice, never a huge wall-sized framebuffer.
        const ratio = Math.min(window.devicePixelRatio || 1, 1, 1920 / width, 1080 / height)*quality;
        const w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        gl.viewport(0, 0, w, h);
        const count = config.screens || 1, index = config.index || 0;
        const rect = rectangle(width * count, height, aspectFor(video.videoWidth, video.videoHeight, config.source), config.fit);
        gl.uniform2f(uniforms.viewport, width, height); gl.uniform4f(uniforms.picture, rect.x, rect.y, rect.width, rect.height);
        gl.uniform1f(uniforms.strength, Math.max(0, Math.min(100, config.depth ?? 50)) / 100);
        gl.uniform1f(uniforms.offsetX, width * index); gl.uniform1f(uniforms.stereo, config.source === '2d' ? 0 : 1);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        if(textureWidth!==video.videoWidth || textureHeight!==video.videoHeight){
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,video.videoWidth,video.videoHeight,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
          textureWidth=video.videoWidth;textureHeight=video.videoHeight;lastMediaTime=-1;metrics.allocations++;
        }
        if(lastMediaTime!==mediaTime){gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,video);lastMediaTime=mediaTime;metrics.uploads++;}
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        if(canvas.hidden)canvas.hidden = false;
        // The opaque canvas covers the native picture. Hiding the video itself
        // makes Chromium throttle its decoded-frame callbacks (as low as 1 fps).
        if(video.style.visibility)video.style.visibility = '';
        metrics.draws++;metrics.renderMs=performance.now()-began;
        slowFrames=metrics.renderMs>16?slowFrames+1:Math.max(0,slowFrames-1);
        if(slowFrames>=20&&quality>.5){quality=Math.max(.5,quality*.75);slowFrames=0;}
      } catch { failure(); }
    }
    function schedule() {
      stop();
      if (!config.active || failed || disposed || video.paused || video.ended || document.hidden) return;
      // An occluded video can throttle rVFC even while its decoder advances.
      // Poll only the cheap native frame counter; upload/draw each decoded frame
      // once. No idle GPU work, duplicate 60-Hz uploads, or callback starvation.
      const next = () => { raf = undefined;const key=frameKey();if(key!==lastMediaTime)draw(key);schedule(); };
      raf = requestAnimationFrame(next);
    }
    function redraw() { draw(); schedule(); }
    function reset() { lastMediaTime=-1;normal(); redraw(); }
    const listeners = { play: redraw, pause: redraw, seeked: redraw, loadeddata: redraw, emptied: reset, resize: redraw };
    for (const [event, handler] of Object.entries(listeners)) video.addEventListener(event, handler);
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {bounds=null;redraw();}) : null; resize?.observe(canvas.parentElement);
    document.addEventListener('visibilitychange', redraw);
    const lost = event => { event.preventDefault(); failure(); };
    const restored = () => { gl = null;textureWidth=textureHeight=0;lastMediaTime=-1; failed = false; redraw(); };
    canvas.addEventListener('webglcontextlost', lost); canvas.addEventListener('webglcontextrestored', restored);
    return {
      set(next) {
        const changed = JSON.stringify(config) !== JSON.stringify(next); config = next;
        if (!next.active) { stop(); normal(); return; }
        if (changed) redraw();
      },
      get available() { return !failed; },
      get stats() { return {...metrics,quality}; },
      dispose() {
        disposed = true; stop(); normal(); resize?.disconnect();
        for (const [event, handler] of Object.entries(listeners)) video.removeEventListener(event, handler);
        document.removeEventListener('visibilitychange', redraw);
        canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('webglcontextrestored', restored);
        if (gl) { gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program); }
      },
    };
  }
  const api = { create, rectangle, aspectFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CineWallVideo3D = api;
})();
