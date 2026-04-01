const axios = require('axios');

const http = axios.create({
  timeout: 10000, // Increased timeout to 10 seconds for slower providers
  headers: {
    // Disguise axios as a real Chrome browser to bypass Cloudflare 403s
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1'
  }
});

http.interceptors.response.use(null, async (error) => {
  const config = error.config;
  if (!config) return Promise.reject(error);
  
  if (!config.retry) {
    config.retry = 1;
  } else if (config.retry >= 2) {
    return Promise.reject(error);
  } else {
    config.retry += 1;
  }
  
  // Do not retry on strict authentication or not found errors
  if (error.response && [401, 404].includes(error.response.status)) {
    return Promise.reject(error); 
  }
  
  // Retry on 403 (bot blocks), 429 (rate limits), and 503 (server overloaded)
  await new Promise(resolve => setTimeout(resolve, 1500));
  return http(config);
});

module.exports = { http };
