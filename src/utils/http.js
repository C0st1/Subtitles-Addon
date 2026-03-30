const axios = require('axios');
const https = require('https');

const http = axios.create({
  timeout: 5000, // Strict 5-second timeout
  httpsAgent: new https.Agent({ 
    keepAlive: true, 
    maxSockets: 50, 
    freeSocketTimeout: 30000 
  }),
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1'
  }
});

// Removed the retry interceptor entirely. 
// Serverless functions should fail fast rather than retry in the background.

module.exports = { http };
