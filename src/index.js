const express = require('express');
const cors = require('cors');
const path = require('path');
const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('./addon');
const proxyRoute = require('./routes/subtitle-proxy');
const logger = require('./utils/logger');

const app = express();
app.use(cors());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/configure.html'));
});

app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/configure.html'));
});

// Update the mount to dynamically match '.vtt' or '.srt' extensions
app.get('/subtitle/:provider/:subtitleId.:ext', proxyRoute);

app.use((req, res, next) => {
  const match = req.url.match(/^\/([a-zA-Z0-9-_]+)\/(.*)$/);
  if (match) {
    try {
      let b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      
      const configObj = JSON.parse(decoded);
      
      // Prevent crash if a malicious user passes a non-object base64 JSON payload
      if (typeof configObj !== 'object' || configObj === null) {
          throw new Error("Invalid config object");
      }
      
      configObj.addon_host = req.headers.host;
      req.url = `/${encodeURIComponent(JSON.stringify(configObj))}/${match[2]}`;
    } catch (e) {
      // Not a valid base64 config, proceed normally
    }
  }
  next();
});

const addonRouter = getRouter(addonInterface);
app.use('/', addonRouter);

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 7000;
  app.listen(PORT, () => {
    logger.info('system', `Addon running at http://localhost:${PORT}`);
  });
}

module.exports = app;
