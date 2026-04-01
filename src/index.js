'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('./addon');
const proxyRoute = require('./routes/subtitle-proxy');
const logger = require('./utils/logger');

const app = express();

// Required for Vercel and any reverse proxy — enables correct IP identification
// for rate limiting and security headers (X-Forwarded-For, X-Forwarded-Proto)
app.set('trust proxy', true);
app.use(cors());

// Add request ID for log correlation in serverless environments
app.use((req, res, next) => {
  process.env.__REQUEST_ID__ = req.headers['x-vercel-id'] ||
    req.headers['x-request-id'] ||
    `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  next();
});

// Global rate limiting
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

// Serve configure page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/configure.html'));
});

app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/configure.html'));
});

// Serve logo as static asset (avoids dependency on external GitHub URL)
app.get('/logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/logo.png'));
});

// Stricter rate limit for subtitle proxy (potential SSRF target)
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
 * This is the standard Stremio addon configuration pattern.
 *
 * Security notes:
 * - API keys in the URL config are only used for provider API queries (handler side).
 * - Subtitle proxy URLs use only env vars for API keys (stripped from URL-safe config).
 * - Host header is validated to prevent injection attacks.
 */
app.use((req, res, next) => {
  const match = req.url.match(/^\/([a-zA-Z0-9-_]+)\/(.*)$/);
  if (match) {
    try {
      let b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const decoded = Buffer.from(b64, 'base64').toString('utf8');

      const configObj = JSON.parse(decoded);

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
      configObj.addon_host = sanitizedHost;

      req.url = `/${encodeURIComponent(JSON.stringify(configObj))}/${match[2]}`;
    } catch (e) {
      // Log parse/validation errors for debugging (was previously silently swallowed)
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
 * Rejects obviously malicious values containing protocols, paths, or query strings.
 * @param {string} host
 * @returns {string|null} Sanitized host, or null if invalid
 */
function sanitizeHost(host) {
  if (!host || typeof host !== 'string') return null;
  const trimmed = host.trim();

  // Reject if it contains a protocol scheme (e.g., "http://" or "//")
  if (trimmed.includes('://') || trimmed.startsWith('//')) return null;

  // Reject if it contains path separators or query strings
  if (trimmed.includes('/') || trimmed.includes('?') || trimmed.includes('#')) return null;

  // Reject if it contains whitespace or control characters
  if (/\s/.test(trimmed)) return null;

  // Validate basic hostname format
  const hostPattern = /^[a-zA-Z0-9]([a-zA-Z0-9.\-]*[a-zA-Z0-9])?(:\d{1,5})?$/;
  if (!hostPattern.test(trimmed)) return null;

  // Validate port number if present (1-65535)
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
