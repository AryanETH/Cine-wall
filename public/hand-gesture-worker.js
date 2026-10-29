'use strict';
// Camera frames never leave this same-origin worker. Only gesture labels return to the UI.
let recognizer;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      importScripts('/vendor/mediapipe/vision_bundle.js');
      const files = await Vision.FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
      recognizer = await Vision.GestureRecognizer.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/models/gesture_recognizer.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: .6, minHandPresenceConfidence: .6, minTrackingConfidence: .6
      });
      self.postMessage({ type: 'ready' });
    } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
    return;
  }
  if (data.type !== 'frame') return;
  try {
    if (!recognizer) throw Error('Gesture model is not ready.');
    const result = recognizer.recognizeForVideo(data.frame, data.timestamp);
    self.postMessage({ type: 'result', result: { gestures: result.gestures, landmarks: result.landmarks }, timestamp: data.timestamp });
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
  finally { data.frame.close(); }
};
