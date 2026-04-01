'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');
const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('./addon');
const proxyRoute = require('./routes/subtitle-proxy');
const logger = require('./utils/logger');

// --- Request-scoped storage (replaces process.env mutation) ---
const asyncLocalStorage = new AsyncLocalStorage();

/**
 * Generate a CSP nonce for inline scripts.
 */
function generateNonce() {
  return crypto.randomBytes(16).toString('base64');
}

// --- Allowed config keys whitelist ---
const ALLOWED_CONFIG_KEYS = new Set([
  'opensubtitles_api_key',
  'subdl_api_key',
  'subsource_api_key',
  'languages',
  'enabled_sources',
  'addon_host',
]);

/**
 * Sanitize config object: keep only whitelisted keys, strip everything else.
 * @param {object} configObj
 * @returns {object}
 */
function sanitizeConfig(configObj) {
  const sanitized = {};
  for (const key of Object.keys(configObj)) {
    if (ALLOWED_CONFIG_KEYS.has(key)) {
      sanitized[key] = configObj[key];
    }
  }
  return sanitized;
}

const app = express();
app.set('trust proxy', 1); // Trust 1 proxy layer (Vercel edge)

// --- Security headers via helmet ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (req, res) => {
        // Generate and attach a nonce for inline scripts in configure.html
        const nonce = generateNonce();
        res.locals.cspNonce = nonce;
        return `'nonce-${nonce}'`;
      }],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://raw.githubusercontent.com"],
      connectSrc: ["'self'", "https://api.opensubtitles.com", "https://api.subdl.com", "https://api.subsource.net", "https://v3-cinemeta.strem.io", "https://dl.subdl.com", "https://www.opensubtitles.com"],
      formAction: ["'self'"],
    },
  },
}));

// --- Body size limit ---
app.use(express.json({ limit: '100kb' }));

app.use(cors());

// --- Request ID via AsyncLocalStorage (replaces process.env mutation) ---
app.use((req, res, next) => {
  const requestId = req.headers['x-vercel-id'] ||
    req.headers['x-request-id'] ||
    `req-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  asyncLocalStorage.run({ requestId }, () => {
    next();
  });
});

// Expose a helper so the logger can read request-scoped data
app.set('asyncLocalStorage', asyncLocalStorage);

// --- Global rate limiting ---
const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
  max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('system', 'Global rate limit exceeded', { ip: req.ip });
    res.status(429).json({ error: 'Too many requests, please try again later.' });
  }
});
app.use(globalLimiter);

// --- Health check endpoint ---
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: require('./manifest').version,
  });
});

// --- Serve configure page (with CSP nonce injection for inline scripts) ---
const configureHtml = fs.readFileSync(path.join(__dirname, '../public/configure.html'), 'utf8');

/**
 * Send the configure.html page, optionally with pre-fill configuration data.
 * When prefillConfig is provided, injects it as window.__INITIAL_CONFIG__ so the
 * frontend can restore form values (used when user returns via the Gear icon).
 *
 * @param {object} req
 * @param {object} res
 * @param {object|null} prefillConfig - decoded config object to pre-fill, or null
 */
function sendConfigurePage(req, res, prefillConfig) {
  const nonce = res.locals.cspNonce || generateNonce();
  res.locals.cspNonce = nonce;
  let html = configureHtml.replace(/\{\{CSP_NONCE\}\}/g, nonce);

  // Inject initial config for pre-fill (escape to prevent XSS in inline script)
  if (prefillConfig) {
    const configJson = JSON.stringify(prefillConfig)
      .replace(/&/g, '\\u0026')
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e');
    html = html.replace('{{INITIAL_CONFIG}}', configJson);
  } else {
    html = html.replace('{{INITIAL_CONFIG}}', 'null');
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

// --- Base configure page routes (no config segment) ---
app.get('/', (req, res) => {
  // Support pre-fill via ?config=BASE64 query parameter as fallback
  let prefillConfig = null;
  if (req.query.config) {
    prefillConfig = decodeConfigFromBase64(req.query.config);
  }
  sendConfigurePage(req, res, prefillConfig);
});

app.get('/configure', (req, res) => {
  // Support pre-fill via ?config=BASE64 query parameter as fallback
  let prefillConfig = null;
  if (req.query.config) {
    prefillConfig = decodeConfigFromBase64(req.query.config);
  }
  sendConfigurePage(req, res, prefillConfig);
});

// --- Serve logo as static asset ---
app.get('/logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/logo.png'));
});

// --- Stricter rate limit for subtitle proxy ---
const proxyLimiter = rateLimit({
  windowMs: 60000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('proxy', 'Proxy rate limit exceeded', { ip: req.ip });
    res.status(429).json({ error: 'Too many subtitle requests, please try again later.' });
  }
});

// Subtitle proxy route (with stricter rate limiting)
app.get('/subtitle/:provider/:subtitleId.:ext', proxyLimiter, proxyRoute);

// --- Paths handled by our custom routes (not forwarded to addonRouter) ---
const CUSTOM_PATHS = new Set(['manifest.json', 'configure', 'logo.png']);

/**
 * Config middleware: decodes base64url-encoded config from URL path segment.
 * Applies whitelist validation to prevent config key injection.
 *
 * For custom-handled paths (manifest.json, configure, logo.png), the decoded
 * config is attached to req.userConfig WITHOUT rewriting req.url, so our custom
 * route handlers can access it directly.
 *
 * For all other paths (addon API routes like subtitles, catalog, stream), the
 * URL is rewritten to the stremio-addon-sdk format:
 *   /{encodedConfigJSON}/manifest.json  →  /{percentEncodedJSON}/manifest.json
 */
app.use((req, res, next) => {
  const match = req.url.match(/^\/([a-zA-Z0-9-_]+)\/(.*)$/);
  if (match) {
    try {
      let b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const decoded = Buffer.from(b64, 'base64').toString('utf8');

      let configObj = JSON.parse(decoded);

      // Reject arrays and non-objects
      if (Array.isArray(configObj) || typeof configObj !== 'object' || configObj === null) {
        throw new Error("Invalid config object: expected a JSON object");
      }

      // Validate and sanitize Host header to prevent injection attacks
      const rawHost = req.headers.host || '';
      const sanitizedHost = sanitizeHost(rawHost);
      if (!sanitizedHost) {
        logger.warn('system', 'Invalid Host header rejected', { rawHost });
        throw new Error("Invalid host header");
      }

      // Whitelist config keys — strip any unknown keys
      configObj = sanitizeConfig(configObj);
      configObj.addon_host = sanitizedHost;

      // Store decoded config and segment for custom routes
      req.userConfig = configObj;
      req.configSegment = match[1];

      // Only rewrite URL for addon API routes (not our custom-handled paths)
      const subPath = match[2].split('?')[0]; // Strip query string for comparison
      if (!CUSTOM_PATHS.has(subPath)) {
        req.url = `/${encodeURIComponent(JSON.stringify(configObj))}/${match[2]}`;
      }
    } catch (e) {
      // Log parse/validation errors for debugging
      if (e.message && !e.message.includes('Invalid config') && !e.message.includes('Invalid host')) {
        logger.warn('system', `Config decode failed: ${e.message}`);
      }
      // Not a valid base64 config, proceed normally
    }
  }
  next();
});

/**
 * Sanitize the Host header to prevent injection attacks.
 * Only allows valid hostnames (domain names, IPs, host:port).
 */
function sanitizeHost(host) {
  if (!host || typeof host !== 'string') return null;
  const trimmed = host.trim();

  if (trimmed.includes('://') || trimmed.startsWith('//')) return null;
  if (trimmed.includes('/') || trimmed.includes('?') || trimmed.includes('#')) return null;
  if (/\s/.test(trimmed)) return null;

  const hostPattern = /^[a-zA-Z0-9]([a-zA-Z0-9.\-]*[a-zA-Z0-9])?(:\d{1,5})?$/;
  if (!hostPattern.test(trimmed)) return null;

  const portMatch = trimmed.match(/:(\d+)$/);
  if (portMatch) {
    const port = parseInt(portMatch[1], 10);
    if (port < 1 || port > 65535) return null;
  }

  return trimmed;
}

/**
 * Decode a base64url-encoded config string into a JSON object.
 * Used for ?config= query parameter pre-fill on base routes.
 * Returns null on failure.
 */
function decodeConfigFromBase64(b64) {
  try {
    let normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (normalized.length % 4) normalized += '=';
    const decoded = Buffer.from(normalized, 'base64').toString('utf8');
    const configObj = JSON.parse(decoded);
    if (Array.isArray(configObj) || typeof configObj !== 'object' || configObj === null) {
      return null;
    }
    return sanitizeConfig(configObj);
  } catch (e) {
    return null;
  }
}

// =========================================================================
//  Custom Manifest & Configure Routes (must be BEFORE addonRouter)
// =========================================================================

/**
 * Dynamic manifest with configurationURL injection.
 *
 * When installed with config (e.g., https://domain.com/BASE64/manifest.json),
 * the configurationURL is set to https://domain.com/BASE64/configure so that
 * the Stremio Gear icon opens the configure page WITH the user's current
 * settings pre-filled.
 */
app.get('/:segment/manifest.json', (req, res) => {
  const manifest = { ...require('./manifest') };
  const protocol = req.protocol;
  const host = req.headers.host;

  // Build configurationURL pointing to the configure page with the same config segment
  if (req.userConfig) {
    manifest.behaviorHints.configurationURL = `${protocol}://${host}/${req.configSegment}/configure`;
  } else {
    manifest.behaviorHints.configurationURL = `${protocol}://${host}/configure`;
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(manifest);
});

/**
 * Pre-filled configure page — opened when user clicks the Gear icon.
 * The config middleware decodes the base64 segment and attaches it to
 * req.userConfig, which is then injected into the HTML for form pre-fill.
 */
app.get('/:segment/configure', (req, res) => {
  sendConfigurePage(req, res, req.userConfig || null);
});

/**
 * Logo served from config-prefixed URL (same logo, different path).
 */
app.get('/:segment/logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/logo.png'));
});

/**
 * Base manifest.json (no config segment) — also gets configurationURL.
 */
app.get('/manifest.json', (req, res) => {
  const manifest = { ...require('./manifest') };
  const protocol = req.protocol;
  const host = req.headers.host;
  manifest.behaviorHints.configurationURL = `${protocol}://${host}/configure`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(manifest);
});

// --- Stremio addon SDK router (handles /subtitles, /catalog, /stream, etc.) ---
const addonRouter = getRouter(addonInterface);
app.use('/', addonRouter);

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 7000;
  app.listen(PORT, () => {
    logger.info('system', `Addon running at http://localhost:${PORT}`);
  });
}

module.exports = app;
