'use strict';
// Public web configuration only. Never expose an Admin SDK/service-account key.
module.exports = function firebaseConfig(env = process.env) {
  const defaults = env === process.env ? require('./firebase-web-config.json') : {};
  const config = Object.fromEntries(['apiKey', 'authDomain', 'projectId', 'appId'].map(key => [key, env[`CINEWALL_FIREBASE_${key.replace(/[A-Z]/g, c => `_${c}`).toUpperCase()}`] || defaults[key] || '']));
  const enabled = Object.values(config).every(Boolean) && /^[a-z0-9.-]+$/.test(config.authDomain);
  return { enabled, config: enabled ? config : null };
};
