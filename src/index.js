const express = require('express');
const cors = require('cors');
const path = require('path');
const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('./addon');
const proxyRoute = require('./routes/subtitle-proxy');
const logger = require('./utils/logger');

const app = express();
app.use(cors());

// ── Static / configuration pages ────────────────────────────────────────────

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/configure.html'));
});

app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/configure.html'));
});

// ── Subtitle proxy ───────────────────────────────────────────────────────────
// Supports both .vtt and .srt extensions so the player can request either format.

app.get('/subtitle/:provider/:subtitleId.:ext', proxyRoute);

// ── Stremio SDK router with config injection ─────────────────────────────────
//
// Stremio passes user configuration as a base64url-encoded JSON segment in the
// URL path, e.g. /eyJhcGkiOiJ4eHgifQ/manifest.json
//
// The middleware below decodes that segment and rewrites the URL into the
// format the Stremio SDK expects (/JSON_STRING/manifest.json).
//
// Security notes:
//   - We validate the decoded value is a plain object before using it.
//   - addon_host is set from the environment (ADDON_HOST) or a validated header,
//     NOT blindly from req.headers.host, to prevent Host-header injection attacks
//     that could cause proxy URLs to leak API keys to attacker-controlled servers.
//     See utils/validate.js → resolveAddonHost().

app.use((req, res, next) => {
  const match = req.url.match(/^\/([A-Za-z0-9+/=_-]{10,})\/(.*)/);
  if (!match) return next();

  try {
    // Normalise base64url → standard base64 with padding
    let b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';

    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    const configObj = JSON.parse(decoded);

    if (typeof configObj !== 'object' || configObj === null || Array.isArray(configObj)) {
      throw new Error('Config payload must be a plain object');
    }

    // Inject the request host so the handler can build correct proxy URLs.
    // resolveAddonHost gives priority to the ADDON_HOST env variable so that
    // production deployments are never dependent on the (user-controlled) Host header.
    const { resolveAddonHost } = require('./utils/validate');
    configObj.addon_host = resolveAddonHost(req.headers.host);

    req.url = `/${encodeURIComponent(JSON.stringify(configObj))}/${match[2]}`;
  } catch (e) {
    // Not a base64 config segment — fall through to the SDK router normally.
    // Log at debug level only; this fires legitimately for non-config routes.
    logger.info('middleware', `Config decode skipped: ${e.message}`);
  }

  next();
});

const addonRouter = getRouter(addonInterface);
app.use('/', addonRouter);

// ── Local dev server ─────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 7000;
  app.listen(PORT, () => {
    logger.info('system', `Addon running at http://localhost:${PORT}`);
    logger.info('system', `Configure at http://localhost:${PORT}/configure`);
  });
}

module.exports = app;
