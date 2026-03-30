const axios = require('axios');

const http = axios.create({
  timeout: 6000 // 6 seconds timeout for network requests
});

// Simple retry interceptor
http.interceptors.response.use(null, async (error) => {
  const config = error.config;
  if (!config || !config.retry) {
    config.retry = 1;
  } else if (config.retry >= 2) {
    return Promise.reject(error);
  }
  
  config.retry += 1;
  if (error.response && error.response.status === 429) {
    return Promise.reject(error); // Don't retry rate limits immediately
  }
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  return http(config);
});

module.exports = { http };
