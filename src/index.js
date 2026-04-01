const express = require('express');
const cors = require('cors');
const path = require('path'); // Added to handle file paths
const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('./addon');
const proxyRoute = require('./routes/subtitle-proxy');
const logger = require('./utils/logger');

const app = express();
app.use(cors());

// Serve the physical HTML file from the /public directory
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/configure.html'));
});

app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/configure.html'));
});

// Mount the custom subtitle proxy route
app.get('/subtitle/:provider/:subtitleId.vtt', proxyRoute);

// Middleware to decode Base64URL config so stremio-addon-sdk can process it
app.use((req, res, next) => {
  const match = req.url.match(/^\/([a-zA-Z0-9-_]+)\/(.*)$/);
  if (match) {
    try {
      // Safely decode Base64URL
      let b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      
      const configObj = JSON.parse(decoded); // Validate it is valid JSON
      
      // Dynamically inject the correct host into the config for the proxy URLs
      configObj.addon_host = req.headers.host;
      
      // Rewrite the URL into standard URL-encoded JSON for the SDK router
      req.url = `/${encodeURIComponent(JSON.stringify(configObj))}/${match[2]}`;
    } catch (e) {
      // Not a valid base64 config, just proceed
    }
  }
  next();
});

// Mount the Stremio Addon SDK router
const addonRouter = getRouter(addonInterface);
app.use('/', addonRouter);

// Local development server
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 7000;
  app.listen(PORT, () => {
    logger.info('system', `Addon running at http://localhost:${PORT}`);
  });
}

// Export for Vercel serverless
module.exports = app;
