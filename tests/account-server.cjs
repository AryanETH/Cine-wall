'use strict';
// Test entrypoint only (excluded from the deployment image). Real signatures
// and claims are verified against a temporary RSA key instead of Google's keys.
const { createPublicKey } = require('node:crypto');
const filename = require.resolve('../account-auth');
const actual = require(filename);
const verifyToken = actual.createVerifier({ projectId: 'cinewall-test', keyResolver: () => createPublicKey(process.env.CINEWALL_TEST_PUBLIC_KEY) });
require.cache[filename].exports = { ...actual, createAccountAuth: options => actual.createAccountAuth({ ...options, verifyToken }) };
require('../server');
