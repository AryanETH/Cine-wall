'use strict';

const MAX_BYTES = 128 * 1024;
const DEADLINE_MS = 15000;
const failure = (status, message) => Object.assign(new Error(message), { status });

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => abortBody(failure(408, 'Request body timed out.')), DEADLINE_MS);
    timer.unref();

    function cleanup() {
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('close', onClose);
      req.off('error', onError);
    }
    function abortBody(error) {
      cleanup();
      reject(error);
      // Stop reading the body and free the socket on overflow or timeout.
      req.destroy();
    }
    function onData(chunk) {
      size += chunk.length;
      if (size > MAX_BYTES) abortBody(failure(413, 'Request is too large.'));
      else chunks.push(chunk);
    }
    function onEnd() {
      cleanup();
      try {
        const value = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        resolve(value);
      } catch {
        reject(failure(400, 'Invalid JSON object.'));
      }
    }
    function onError() {
      cleanup();
      reject(failure(400, 'Request body was interrupted.'));
    }
    function onClose() {
      if (!req.readableEnded) onError();
    }

    if (req.destroyed) { onError(); return; }
    if (Number(req.headers['content-length']) > MAX_BYTES) {
      abortBody(failure(413, 'Request is too large.'));
      return;
    }
    req.on('error', onError);
    req.on('close', onClose);
    req.on('end', onEnd);
    req.on('data', onData);
  });
}

module.exports = readJson;
