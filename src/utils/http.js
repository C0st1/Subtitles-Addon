const axios = require('axios');
const https = require('https');

/**
 * Shared HTTP client for all provider and proxy requests.
 *
 * Improvements over original:
 * - Removed browser User-Agent (deceptive for API calls; each provider sets
 *   its own UA in request headers when the API requires it).
 * - Kept keepAlive pool for connection reuse across serverless warm invocations.
 * - 5-second timeout is enforced at the instance level; individual callers
 *   can still override per-request.
 */
const http = axios.create({
  timeout: 5000,
  httpsAgent: new https.Agent({
    keepAlive: true,
    maxSockets: 50,
    freeSocketTimeout: 30000,
  }),
  headers: {
    'Accept': 'application/json, */*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Connection': 'keep-alive',
  },
});

module.exports = { http };
