'use strict';
// Camera frames stay local. Only detection results return to the UI.
let recognizer;
let rotation = 0, probeRotation = 0, lastProbe = -Infinity, rotatedCanvas;
function sourceAt(frame, turns) {
  if (!turns) return frame;
  if (!rotatedCanvas) rotatedCanvas = new OffscreenCanvas(1, 1);
  const width = turns % 2 ? frame.height : frame.width, height = turns % 2 ? frame.width : frame.height;
  if (rotatedCanvas.width !== width) rotatedCanvas.width = width;
  if (rotatedCanvas.height !== height) rotatedCanvas.height = height;
  const context = rotatedCanvas.getContext('2d');
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
  context.rotate(turns * Math.PI / 2);
  context.drawImage(frame, -frame.width / 2, -frame.height / 2);
  return rotatedCanvas;
}
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      importScripts('/vendor/mediapipe/vision_bundle.js');
      importScripts('/hand-gestures.js?v=20261029-poses-2');
      const files = await Vision.FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
      recognizer = await Vision.GestureRecognizer.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/models/gesture_recognizer.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: .5, minHandPresenceConfidence: .5, minTrackingConfidence: .5
      });
      self.postMessage({ type: 'ready' });
    } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
    return;
  }
  if (data.type !== 'frame') return;
  try {
    if (!recognizer) throw Error('Gesture model is not ready.');
    const normalize = (result, turns) => self.CineWallHandGestures.unrotateResult({ gestures: result.gestures, landmarks: result.landmarks,
      worldLandmarks: result.worldLandmarks, imageAspect: data.frame.height / data.frame.width }, turns);
    let raw = recognizer.recognizeForVideo(sourceAt(data.frame, rotation), data.timestamp);
    let normalized = normalize(raw, rotation);
    const uncertain = !raw.landmarks.length || raw.gestures.every(categories => !categories[0] || categories[0].categoryName === 'None');
    if (uncertain && !self.CineWallHandGestures.labelFromResult(normalized) && typeof OffscreenCanvas !== 'undefined' && data.timestamp - lastProbe >= 250) {
      lastProbe = data.timestamp;
      let next = (probeRotation + 1) % 4;
      if (next === rotation) next = (next + 1) % 4;
      probeRotation = next;
      const probe = recognizer.recognizeForVideo(sourceAt(data.frame, next), data.timestamp + .01);
      const candidate = normalize(probe, next);
      if (!raw.landmarks.length || self.CineWallHandGestures.labelFromResult(candidate)) {
        rotation = next;
        normalized = candidate;
      }
    }
    self.postMessage({ type: 'result', result: normalized, timestamp: data.timestamp });
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
  finally { data.frame.close(); }
};
