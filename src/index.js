const express = require('express');
const cors = require('cors');
const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('./addon');
const proxyRoute = require('./routes/subtitle-proxy');
const logger = require('./utils/logger');

const app = express();
app.use(cors());

// Inline HTML to prevent Vercel missing-file crashes
const configureHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Configure Subtitle Aggregator</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; background: #1e1e1e; color: #fff; }
    label { display: block; margin-top: 15px; font-weight: bold; }
    input[type="text"], input[type="password"] { width: 100%; padding: 10px; margin-top: 5px; border-radius: 5px; border: 1px solid #444; background: #333; color: #fff; }
    button { margin-top: 25px; padding: 12px 20px; background: #8a5a96; color: white; border: none; border-radius: 5px; cursor: pointer; width: 100%; font-size: 16px; }
    button:hover { background: #6b4675; }
    .links { margin-top: 20px; padding: 15px; background: #2a2a2a; border-radius: 5px; display: none; word-break: break-all; }
    a { color: #b388ff; }
  </style>
</head>
<body>
  <h2>Subtitle Aggregator Configuration</h2>
  <form id="configForm">
    <label>OpenSubtitles API Key (Optional)</label>
    <input type="password" id="opensubtitles_api_key">
    <label>SubDL API Key</label>
    <input type="password" id="subdl_api_key">
    <label>SubSource API Key</label>
    <input type="password" id="subsource_api_key">
    <label>Subs.ro API Key</label>
    <input type="password" id="subsro_api_key">
    <label>Languages (ISO 639-2, comma-separated)</label>
    <input type="text" id="languages" value="eng,ron">
    <label>Enabled Sources (comma-separated)</label>
    <input type="text" id="enabled_sources" value="opensubtitles,subdl,subsource,subsro">
    <label>
      <input type="checkbox" id="force_encoding_detection">
      Force Stremio local encoding detection (fallback for severe diacritic issues)
    </label>
    <button type="button" onclick="generateLink()">Generate Install Link</button>
  </form>
  <div class="links" id="linksContainer">
    <p><strong>Stremio Install Link:</strong><br><a id="stremioLink" href="#">Install</a></p>
    <p><strong>Manual URL:</strong><br><span id="manualUrl"></span></p>
  </div>
  <script>
    function generateLink() {
      const config = {
        opensubtitles_api_key: document.getElementById('opensubtitles_api_key').value,
        subdl_api_key: document.getElementById('subdl_api_key').value,
        subsource_api_key: document.getElementById('subsource_api_key').value,
        subsro_api_key: document.getElementById('subsro_api_key').value,
        languages: document.getElementById('languages').value,
        enabled_sources: document.getElementById('enabled_sources').value,
        force_encoding_detection: document.getElementById('force_encoding_detection').checked
      };
      Object.keys(config).forEach(k => !config[k] && delete config[k]);
      const configStr = JSON.stringify(config);
      const encodedConfig = btoa(configStr).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
      const host = window.location.host;
      const protocol = window.location.protocol;
      const manifestUrl = \`\${protocol}//\${host}/\${encodedConfig}/manifest.json\`;
      const stremioUrl = \`stremio://\${host}/\${encodedConfig}/manifest.json\`;
      document.getElementById('stremioLink').href = stremioUrl;
      document.getElementById('manualUrl').innerText = manifestUrl;
      document.getElementById('linksContainer').style.display = 'block';
    }
  </script>
</body>
</html>`;

app.get('/', (req, res) => res.send(configureHtml));
app.get('/configure', (req, res) => res.send(configureHtml));

// Mount the custom subtitle proxy route
app.get('/subtitle/:provider/:subtitleId.vtt', proxyRoute);

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
