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
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://raw.githubusercontent.com"],
      connectSrc: ["'self'"],
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

function sendConfigurePage(req, res) {
  const nonce = res.locals.cspNonce || generateNonce();
  res.locals.cspNonce = nonce;
  const html = configureHtml.replace(/\{\{CSP_NONCE\}\}/g, nonce);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

app.get('/', sendConfigurePage);
app.get('/configure', sendConfigurePage);

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

/**
 * Config middleware: decodes base64url-encoded config from URL path segment.
 * Applies whitelist validation to prevent config key injection.
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

      req.url = `/${encodeURIComponent(JSON.stringify(configObj))}/${match[2]}`;
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

const addonRouter = getRouter(addonInterface);
app.use('/', addonRouter);

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 7000;
  app.listen(PORT, () => {
    logger.info('system', `Addon running at http://localhost:${PORT}`);
  });
}

module.exports = app;
