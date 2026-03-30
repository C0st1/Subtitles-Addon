const axios = require('axios');

const http = axios.create({
  timeout: 6000 // 6 seconds timeout for network requests
});

// Simple retry interceptor
http.interceptors.response.use(null, async (error) => {
  const config = error.config;
  
  // Early return if config is missing
  if (!config) return Promise.reject(error);
  
  if (!config.retry) {
    config.retry = 1;
  } else if (config.retry >= 2) {
    return Promise.reject(error);
  } else {
    config.retry += 1;
  }
  
  if (error.response && error.response.status === 429) {
    return Promise.reject(error); 
  }
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  return http(config);
});

// THIS WAS MISSING
module.exports = { http };
