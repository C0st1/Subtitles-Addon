const axios = require('axios');
const https = require('https');

const http = axios.create({
  timeout: 5000, // Reduced from 10s to 5s to fail faster and let other providers finish
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

http.interceptors.response.use(null, async (error) => {
  const config = error.config;
  if (!config || config.retry >= 1) return Promise.reject(error);
  
  config.retry = (config.retry || 0) + 1;
  
  if (error.response && [401, 404].includes(error.response.status)) {
    return Promise.reject(error); 
  }
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  return http(config);
});

module.exports = { http };
