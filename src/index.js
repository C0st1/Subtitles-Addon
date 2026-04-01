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
const { translateBatch } = require('./utils/translation');
const { srtToVtt, decodeSrt } = require('./utils/converter');
const { extractSrt, isArchive } = require('./utils/zip');
const { http } = require('./utils/http');
const { validateUrl } = require('./utils/url-validator');
const { LRUCache } = require('lru-cache');

// =========================================================================
//  Optional Sentry integration
// =========================================================================
if (process.env.SENTRY_DSN) {
  try {
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'production',
      tracesSampleRate: 0.1,
      profilesSampleRate: 0.1,
    });
    logger.info('system', 'Sentry initialized');
  } catch (e) {
    logger.warn('system', `Sentry init failed (install @sentry/node): ${e.message}`);
  }
}

// =========================================================================
//  Optional Redis caching
// =========================================================================
let redis = null;
let redisConnected = false;

if (process.env.REDIS_URL) {
  try {
    const Redis = require('ioredis');
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      },
      lazyConnect: true,
    });

    redis.on('connect', () => {
      redisConnected = true;
      logger.info('system', 'Redis connected');
    });

    redis.on('error', (err) => {
      redisConnected = false;
      logger.warn('system', `Redis error: ${err.message}`);
    });

    redis.on('close', () => {
      redisConnected = false;
      logger.warn('system', 'Redis connection closed');
    });

    redis.connect().catch(() => {
      logger.warn('system', 'Redis connection failed, falling back to in-memory cache');
    });
  } catch (e) {
    logger.warn('system', `Redis module not available: ${e.message}`);
    redis = null;
  }
}

// =========================================================================
//  In-memory LRU cache (fallback when Redis is unavailable)
// =========================================================================
const memoryCache = new LRUCache({
  max: 500,
  maxSize: 50 * 1024 * 1024, // 50MB total cache size
  sizeCalculation: (value) => typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0,
  ttl: 1000 * 60 * 60 * 24, // 24 hours
});

/**
 * Unified cache: get a value by key.
 * Tries Redis first (if connected), falls back to in-memory LRU.
 */
async function cacheGet(key) {
  if (redisConnected && redis) {
    try {
      const val = await redis.get(key);
      return val || null;
    } catch (e) {
      logger.warn('cache', `Redis GET failed: ${e.message}`);
    }
  }
  return memoryCache.get(key) || null;
}

/**
 * Unified cache: set a value by key with TTL (seconds).
 */
async function cacheSet(key, value, ttlSeconds) {
  if (redisConnected && redis) {
    try {
      await redis.set(key, value, 'EX', ttlSeconds || 86400);
      return;
    } catch (e) {
      logger.warn('cache', `Redis SET failed: ${e.message}`);
    }
  }
  memoryCache.set(key, value);
}

/**
 * Unified cache: delete a key.
 */
async function cacheDel(key) {
  if (redisConnected && redis) {
    try {
      await redis.del(key);
      return;
    } catch (e) {
      logger.warn('cache', `Redis DEL failed: ${e.message}`);
    }
  }
  memoryCache.delete(key);
}

/**
 * Unified cache: clear all entries.
 */
async function cacheClear() {
  if (redisConnected && redis) {
    try {
      await redis.flushdb();
      logger.info('cache', 'Redis cache flushed');
    } catch (e) {
      logger.warn('cache', `Redis flushdb failed: ${e.message}`);
    }
  }
  memoryCache.clear();
  logger.info('cache', 'In-memory cache cleared');
}

/**
 * Get cache stats for health reporting.
 */
function getCacheStats() {
  const memStats = {
    size: memoryCache.size,
    max: memoryCache.max,
    calculatedSize: memoryCache.calculatedSize || 0,
    maxCalculatedSize: memoryCache.maxSize,
    backend: redisConnected ? 'redis' : 'memory',
  };
  return memStats;
}

// =========================================================================
//  Analytics buffer
// =========================================================================
const MAX_ANALYTICS_BUFFER = 1000;
const analyticsBuffer = [];
let analyticsFlushTimer = null;

const ANALYTICS_URL = process.env.ANALYTICS_URL || '';

/**
 * Record an anonymous analytics event.
 */
function recordAnalyticsEvent(event, data) {
  analyticsBuffer.push({
    event,
    data,
    timestamp: new Date().toISOString(),
  });

  // Trim if over capacity
  if (analyticsBuffer.length > MAX_ANALYTICS_BUFFER) {
    analyticsBuffer.splice(0, analyticsBuffer.length - MAX_ANALYTICS_BUFFER);
  }

  // Flush periodically
  if (!analyticsFlushTimer) {
    analyticsFlushTimer = setTimeout(flushAnalytics, 30000);
    analyticsFlushTimer.unref();
  }
}

/**
 * Flush analytics buffer to log and optionally to remote URL.
 */
async function flushAnalytics() {
  analyticsFlushTimer = null;
  if (analyticsBuffer.length === 0) return;

  const events = analyticsBuffer.splice(0);
  logger.info('analytics', `Flushing ${events.length} analytics events`);

  if (ANALYTICS_URL) {
    try {
      await http.post(ANALYTICS_URL, { events }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      });
    } catch (e) {
      logger.warn('analytics', `Failed to forward analytics: ${e.message}`);
    }
  }
}

// =========================================================================
//  Per-user rate limiter (sliding window)
// =========================================================================
const perUserRateLimiters = new Map();
const PER_USER_MAX = parseInt(process.env.PER_USER_RATE_LIMIT, 10) || 60; // req/min
const PER_USER_WINDOW_MS = 60000;

// Clean up stale entries every 5 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of perUserRateLimiters) {
    if (now - entry.lastReset > PER_USER_WINDOW_MS * 2) {
      perUserRateLimiters.delete(key);
    }
  }
}, 5 * 60 * 1000);
cleanupTimer.unref();

/**
 * Check and update per-user rate limit.
 * Returns true if allowed, false if rate limited.
 */
function checkPerUserRateLimit(userKey) {
  const now = Date.now();
  let entry = perUserRateLimiters.get(userKey);

  if (!entry || now - entry.lastReset > PER_USER_WINDOW_MS) {
    entry = { count: 0, lastReset: now };
    perUserRateLimiters.set(userKey, entry);
  }

  entry.count++;
  return entry.count <= PER_USER_MAX;
}

// =========================================================================
//  Active config tracking
// =========================================================================
const activeConfigs = new Map();

function trackConfig(configSegment) {
  if (!configSegment) return;
  activeConfigs.set(configSegment, Date.now());
  // Trim to keep max 10000 entries
  if (activeConfigs.size > 10000) {
    const sorted = [...activeConfigs.entries()].sort((a, b) => a[1] - b[1]);
    const toRemove = sorted.slice(0, sorted.length - 10000);
    for (const [key] of toRemove) {
      activeConfigs.delete(key);
    }
  }
}

// =========================================================================
//  Request-scoped storage (replaces process.env mutation)
// =========================================================================
const asyncLocalStorage = new AsyncLocalStorage();

/**
 * Generate a CSP nonce for inline scripts.
 */
function generateNonce() {
  return crypto.randomBytes(16).toString('base64');
}

// =========================================================================
//  Allowed config keys whitelist
// =========================================================================
const ALLOWED_CONFIG_KEYS = new Set([
  'opensubtitles_api_key',
  'subdl_api_key',
  'subsource_api_key',
  'languages',
  'enabled_sources',
  'addon_host',
  'addic7ed_username',
  'addic7ed_password',
  'hi_filter',
  'release_matching',
  'mt_fallback',
  'provider_priority',
  'profile_name',
]);

/**
 * Sanitize config object: keep only whitelisted keys, strip everything else.
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

// =========================================================================
//  Express app setup
// =========================================================================
const app = express();
app.set('trust proxy', 1); // Trust 1 proxy layer (Vercel edge)
const START_TIME = Date.now();

// --- Security headers via helmet ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (req, res) => {
        const nonce = generateNonce();
        res.locals.cspNonce = nonce;
        return `'nonce-${nonce}'`;
      }],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://raw.githubusercontent.com"],
      connectSrc: [
        "'self'",
        "https://api.opensubtitles.com",
        "https://api.subdl.com",
        "https://api.subsource.net",
        "https://v3-cinemeta.strem.io",
        "https://dl.subdl.com",
        "https://www.opensubtitles.com",
      ],
      formAction: ["'self'"],
    },
  },
}));

// --- Body size limit ---
app.use(express.json({ limit: '100kb' }));
app.use(cors());

// --- Request ID via AsyncLocalStorage ---
app.use((req, res, next) => {
  const requestId = req.headers['x-vercel-id'] ||
    req.headers['x-request-id'] ||
    `req-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  asyncLocalStorage.run({ requestId }, () => {
    next();
  });
});

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

// =========================================================================
//  Enhanced health check endpoint
// =========================================================================
app.get('/health', (req, res) => {
  const uptime = Math.round((Date.now() - START_TIME) / 1000);
  const cacheStats = getCacheStats();
  let failoverState = {};
  try {
    const handler = require('./handlers/subtitles');
    if (handler.getFailoverState) failoverState = handler.getFailoverState();
  } catch (e) {
    // ignore
  }

  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: require('./manifest').version,
    uptime,
    cache: cacheStats,
    redis: {
      connected: redisConnected,
      url: process.env.REDIS_URL ? 'configured' : 'not configured',
    },
    failover: failoverState,
    analytics: {
      bufferSize: analyticsBuffer.length,
      remoteUrl: ANALYTICS_URL ? 'configured' : 'not configured',
    },
    activeConfigs: activeConfigs.size,
    sentry: process.env.SENTRY_DSN ? 'configured' : 'not configured',
    mt: process.env.MT_SERVICE_URL ? 'configured' : 'not configured',
  });
});

// =========================================================================
//  Cache management endpoints
// =========================================================================

app.get('/cache/stats', (req, res) => {
  res.json(getCacheStats());
});

app.post('/cache/clear', async (req, res) => {
  await cacheClear();
  res.json({ status: 'ok', message: 'Cache cleared' });
});

// =========================================================================
//  Analytics endpoint
// =========================================================================

app.post('/analytics/event', (req, res) => {
  const { event, data } = req.body || {};
  if (!event || typeof event !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "event" field' });
  }
  if (!['subtitle_served', 'addon_installed', 'provider_failed', 'config_created'].includes(event)) {
    return res.status(400).json({ error: 'Unknown event type' });
  }

  recordAnalyticsEvent(event, data || {});
  res.json({ status: 'ok' });
});

// =========================================================================
//  Short URL endpoint
// =========================================================================

app.post('/api/shorten', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "url" field' });
  }

  const SHORT_URL_SERVICE = process.env.SHORT_URL_SERVICE;
  if (SHORT_URL_SERVICE) {
    try {
      const response = await http.post(SHORT_URL_SERVICE, { url }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      });
      if (response?.data?.short) {
        return res.json({ short: response.data.short });
      }
    } catch (e) {
      logger.warn('shorten', `Short URL service failed: ${e.message}`);
    }
  }

  // Passthrough mode: return original URL
  res.json({ short: url });
});

// =========================================================================
//  Presets endpoint
// =========================================================================

app.get('/api/presets', (req, res) => {
  const presetsPath = path.join(__dirname, 'presets.json');
  try {
    if (fs.existsSync(presetsPath)) {
      const presets = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));
      res.json(presets);
    } else {
      res.json([]);
    }
  } catch (e) {
    logger.warn('presets', `Failed to load presets: ${e.message}`);
    res.json([]);
  }
});

// =========================================================================
//  i18n endpoint
// =========================================================================

app.get('/api/i18n/:lang', (req, res) => {
  const lang = req.params.lang.replace(/[^a-zA-Z0-9_-]/g, '');
  const i18nPath = path.join(__dirname, 'i18n', `${lang}.json`);

  try {
    if (fs.existsSync(i18nPath)) {
      const translations = JSON.parse(fs.readFileSync(i18nPath, 'utf8'));
      res.json(translations);
    } else {
      // Fallback to English
      const enPath = path.join(__dirname, 'i18n', 'en.json');
      if (fs.existsSync(enPath)) {
        res.json(JSON.parse(fs.readFileSync(enPath, 'utf8')));
      } else {
        res.json({});
      }
    }
  } catch (e) {
    logger.warn('i18n', `Failed to load translations for ${lang}: ${e.message}`);
    res.json({});
  }
});

// =========================================================================
//  Serve configure page (with CSP nonce injection for inline scripts)
// =========================================================================

const configureHtml = fs.readFileSync(path.join(__dirname, '../public/configure.html'), 'utf8');

/**
 * Send the configure.html page, optionally with pre-fill configuration data.
 */
function sendConfigurePage(req, res, prefillConfig) {
  const nonce = res.locals.cspNonce || generateNonce();
  res.locals.cspNonce = nonce;
  let html = configureHtml.replace(/\{\{CSP_NONCE\}\}/g, nonce);

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

// --- Base configure page routes ---
app.get('/', (req, res) => {
  let prefillConfig = null;
  if (req.query.config) {
    prefillConfig = decodeConfigFromBase64(req.query.config);
  }
  sendConfigurePage(req, res, prefillConfig);
});

app.get('/configure', (req, res) => {
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

// =========================================================================
//  Subtitle proxy route (with stricter rate limiting)
// =========================================================================

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

// =========================================================================
//  Subtitle parsing helpers (for MT translate route)
// =========================================================================

/**
 * Parse SRT/VTT content into structured cue objects.
 * Unlike line-level parsing, this preserves multi-line text within each cue
 * and doesn't break when translation changes internal line counts.
 *
 * @param {string} text - Raw SRT or VTT subtitle text
 * @returns {Array<{index: string, timestamp: string, text: string}>}
 */
function parseSubtitles(text) {
  const cues = [];
  // Split on double newlines (blank line separator between cues)
  const blocks = text.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    if (lines.length < 2) continue;

    // Skip WEBVTT header blocks
    const firstLine = lines[0].trim();
    if (firstLine.startsWith('WEBVTT') || firstLine.startsWith('NOTE')) continue;

    // Find the timestamp line (contains "-->")
    let tsIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        tsIdx = i;
        break;
      }
    }
    if (tsIdx === -1) continue;

    // Everything before the timestamp line that's a number = cue index
    const indexLine = tsIdx > 0 ? lines.slice(0, tsIdx).find(l => /^\d+$/.test(l.trim())) || '' : '';
    const timestampLine = lines[tsIdx].trim();

    // Everything after the timestamp is text (may span multiple lines)
    const textLines = lines.slice(tsIdx + 1)
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (!timestampLine || textLines.length === 0) continue;

    cues.push({
      index: indexLine,
      timestamp: timestampLine,
      text: textLines.join('\n'),
    });
  }

  return cues;
}

/**
 * Convert plain SRT text (already UTF-8 decoded) to WebVTT format.
 * Unlike srtToVtt() from converter.js, this doesn't re-decode the buffer.
 * @param {string} srtText - Plain SRT text in UTF-8
 * @returns {string} WebVTT formatted text
 */
function srtTextToVtt(srtText) {
  const text = srtText.trim();
  if (text.startsWith('WEBVTT')) return text;
  // Replace SRT comma-based milliseconds with VTT dot-based
  const converted = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return 'WEBVTT\n\n' + converted;
}

// =========================================================================
//  Translation proxy route (MUST be before the generic :provider route)
// =========================================================================

app.get('/subtitle/translate/:payload.:ext', proxyLimiter, async (req, res) => {
  const { payload, ext } = req.params;
  const configBase64 = req.query.config;
  const isSrt = ext === 'srt';

  if (ext !== 'srt' && ext !== 'vtt') {
    return res.status(400).send('Invalid file extension. Use .srt or .vtt');
  }

  try {
    // Decode the MT payload
    let mtPayload;
    try {
      mtPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch (e) {
      return res.status(400).send('Invalid payload.');
    }

    const { provider, subtitleId, targetLangs, sourceLang } = mtPayload;
    if (!provider || !subtitleId || !targetLangs) {
      return res.status(400).send('Incomplete payload.');
    }

    const cacheKey = `translate:${ext}:${payload}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      res.setHeader('Content-Type', isSrt ? 'text/plain; charset=utf-8' : 'text/vtt; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Length', Buffer.byteLength(cached, 'utf8'));
      res.setHeader('X-Cache', 'HIT');
      return res.send(cached);
    }

    // Decode config for API keys
    let config = {};
    if (configBase64) {
      try {
        config = JSON.parse(Buffer.from(configBase64, 'base64url').toString('utf8'));
      } catch (e) {
        // ignore
      }
    }

    // Fetch the original subtitle content
    // Reuse the existing proxy logic by constructing a mock req/res
    let originalContent = '';
    try {
      // Fetch subtitle directly using provider-specific download logic
      let subBuffer;
      const decodedSubId = JSON.parse(Buffer.from(subtitleId, 'base64url').toString('utf8'));

      if (provider === 'opensubtitles') {
        const apiKey = config.opensubtitles_api_key || process.env.OPENSUBTITLES_API_KEY;
        if (!apiKey) return res.status(502).send('OpenSubtitles API key not configured.');

        const dlRes = await http.post('https://api.opensubtitles.com/api/v1/download',
          { file_id: parseInt(decodedSubId.id, 10) },
          { headers: { 'Api-Key': apiKey, 'User-Agent': 'SubtitleHub/1.3.0', 'Accept': 'application/json' } }
        );
        if (!dlRes?.data?.link) return res.status(502).send('OpenSubtitles download failed.');
        const urlCheck = await validateUrl(dlRes.data.link);
        if (!urlCheck.valid) return res.status(502).send('Invalid download URL.');
        const fileRes = await http.get(dlRes.data.link, { responseType: 'arraybuffer' });
        subBuffer = Buffer.from(fileRes.data);
      } else if (provider === 'subdl') {
        const dlUrl = decodedSubId.url.startsWith('http')
          ? decodedSubId.url
          : `https://dl.subdl.com${decodedSubId.url.startsWith('/') ? '' : '/'}${decodedSubId.url}`;
        const urlCheck = await validateUrl(dlUrl);
        if (!urlCheck.valid) return res.status(403).send('Blocked: URL not in allowed domains.');
        const fileRes = await http.get(encodeURI(dlUrl), { responseType: 'arraybuffer' });
        subBuffer = Buffer.from(fileRes.data);
        if (isArchive(subBuffer)) subBuffer = await extractSrt(subBuffer, sourceLang);
      } else if (provider === 'subsource') {
        const apiKey = config.subsource_api_key || process.env.SUBSOURCE_API_KEY;
        if (!apiKey) return res.status(502).send('SubSource API key not configured.');

        // New v1 API: download returns ZIP directly
        const subtitleId = decodedSubId.subtitleId || decodedSubId.id;
        if (!subtitleId) return res.status(502).send('Invalid SubSource subtitle ID.');

        const dlRes = await http.get(
          `https://api.subsource.net/api/v1/subtitles/${subtitleId}/download`,
          {
            headers: {
              'X-API-Key': apiKey,
              'Accept': 'application/zip',
            },
            responseType: 'arraybuffer',
            timeout: 15000,
          }
        );
        subBuffer = Buffer.from(dlRes.data);
        if (isArchive(subBuffer)) subBuffer = await extractSrt(subBuffer, sourceLang);
      } else {
        return res.status(400).send('Unknown provider for translation.');
      }

      if (!subBuffer || subBuffer.length === 0) return res.status(502).send('Empty subtitle file.');
      originalContent = decodeSrt(subBuffer, sourceLang);
    } catch (e) {
      logger.error('translate', `Failed to fetch original subtitle: ${e.message}`);
      return res.status(502).send('Failed to fetch original subtitle.');
    }

    // Parse SRT/VTT into structured cues, translate each cue's full text as a unit
    const targetLang = targetLangs.split(',')[0] || 'eng';
    const cues = parseSubtitles(originalContent);

    if (cues.length === 0) {
      return res.status(502).send('No subtitle cues found in file.');
    }

    // Collect cue texts for batch translation (each cue's full text = one unit)
    const cueTexts = cues.map(c => c.text);
    const translatedTexts = await translateBatch(cueTexts, sourceLang, targetLang);

    // Rebuild SRT with translated cue texts, preserving structure
    const rebuiltLines = cues.map((cue, i) => {
      const text = i < translatedTexts.length ? translatedTexts[i] : cue.text;
      return `${cue.index}\n${cue.timestamp}\n${text}`;
    });
    const translatedSrt = rebuiltLines.join('\n\n');

    // Convert to VTT if needed (simple text conversion, no re-decoding)
    let finalContent;
    if (isSrt) {
      finalContent = translatedSrt;
    } else {
      finalContent = srtTextToVtt(translatedSrt);
    }

    await cacheSet(cacheKey, finalContent, 86400);
    recordAnalyticsEvent('subtitle_served', { provider: 'machine-translation', targetLang });

    res.setHeader('Content-Type', isSrt ? 'text/plain; charset=utf-8' : 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Length', Buffer.byteLength(finalContent, 'utf8'));
    res.setHeader('X-Cache', 'MISS');
    res.send(finalContent);
  } catch (error) {
    const msg = error.message || '';
    logger.error('translate', `Translation proxy failed: ${msg}`);
    res.status(500).send('Translation failed.');
  }
});

// Subtitle proxy route (generic — catches /subtitle/:provider/:id.:ext)
app.get('/subtitle/:provider/:subtitleId.:ext', proxyLimiter, proxyRoute);

// =========================================================================
//  Prefetch route
// =========================================================================

app.get('/prefetch/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  const config = req.userConfig || {};

  try {
    const subtitlesHandler = require('./handlers/subtitles');
    await subtitlesHandler({
      type,
      id,
      config,
      extra: { prefetch: true },
    });
    res.json({ status: 'ok', cached: true });
  } catch (e) {
    logger.error('prefetch', `Prefetch failed: ${e.message}`);
    res.json({ status: 'ok', cached: false, error: e.message });
  }
});

// =========================================================================
//  Config middleware
// =========================================================================

// --- Paths handled by our custom routes (not forwarded to addonRouter) ---
const CUSTOM_PATHS = new Set([
  'manifest.json', 'configure', 'logo.png',
  'health', 'cache/stats', 'cache/clear',
  'analytics/event', 'api/shorten', 'api/presets',
]);

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

      // Whitelist config keys
      configObj = sanitizeConfig(configObj);
      configObj.addon_host = sanitizedHost;

      // Store decoded config and segment for custom routes
      req.userConfig = configObj;
      req.configSegment = match[1];

      // Track active config
      trackConfig(match[1]);

      // Per-user rate limiting
      const userKey = crypto.createHash('sha256').update(match[1]).digest('hex');
      if (!checkPerUserRateLimit(userKey)) {
        logger.warn('system', 'Per-user rate limit exceeded', { ip: req.ip });
        return res.status(429).json({ error: 'Per-user rate limit exceeded.' });
      }

      // Only rewrite URL for addon API routes (not our custom-handled paths)
      const subPath = match[2].split('?')[0];
      if (!CUSTOM_PATHS.has(subPath) && !subPath.startsWith('api/') && !subPath.startsWith('subtitle/')) {
        req.url = `/${encodeURIComponent(JSON.stringify(configObj))}/${match[2]}`;
      }
    } catch (e) {
      if (e.message && !e.message.includes('Invalid config') && !e.message.includes('Invalid host')) {
        logger.warn('system', `Config decode failed: ${e.message}`);
      }
      // Not a valid base64 config, proceed normally
    }
  }
  next();
});

// =========================================================================
//  Host sanitization
// =========================================================================

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

// =========================================================================
//  Config decode helper
// =========================================================================

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

app.get('/:segment/manifest.json', (req, res) => {
  const manifest = { ...require('./manifest') };
  const protocol = req.protocol;
  const host = req.headers.host;

  if (req.userConfig) {
    manifest.behaviorHints.configurationURL = `${protocol}://${host}/${req.configSegment}/configure`;
    manifest.behaviorHints.configurationRequired = false;
  } else {
    manifest.behaviorHints.configurationURL = `${protocol}://${host}/configure`;
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(manifest);
});

app.get('/:segment/configure', (req, res) => {
  sendConfigurePage(req, res, req.userConfig || null);
});

app.get('/:segment/logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/logo.png'));
});

app.get('/manifest.json', (req, res) => {
  const manifest = { ...require('./manifest') };
  const protocol = req.protocol;
  const host = req.headers.host;
  manifest.behaviorHints.configurationURL = `${protocol}://${host}/configure`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(manifest);
});

// =========================================================================
//  Stremio addon SDK router
// =========================================================================

const addonRouter = getRouter(addonInterface);
app.use('/', addonRouter);

// =========================================================================
//  Start server
// =========================================================================

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 7000;
  app.listen(PORT, () => {
    logger.info('system', `Addon running at http://localhost:${PORT}`);
  });
}

module.exports = app;
