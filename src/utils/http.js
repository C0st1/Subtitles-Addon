'use strict';

const axios = require('axios');
const https = require('https');

const DEFAULT_TIMEOUT = parseInt(process.env.HTTP_TIMEOUT, 10) || 5000;
const MAX_SOCKETS = parseInt(process.env.MAX_SOCKETS, 10) || 20;

const http = axios.create({
  timeout: DEFAULT_TIMEOUT,
  maxContentLength: 50 * 1024 * 1024, // 50MB response size limit
  maxBodyLength: 50 * 1024 * 1024,   // 50MB request body limit
  httpsAgent: new https.Agent({
    keepAlive: true,
    maxSockets: MAX_SOCKETS,
    freeSocketTimeout: 30000
  }),
  headers: {
    'User-Agent': 'SubtitleHub/1.1.0',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.5',
    'Connection': 'keep-alive'
  }
});

module.exports = { http };
