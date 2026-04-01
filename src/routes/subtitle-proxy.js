'use strict';

const LRU = require('lru-cache');
const logger = require('../utils/logger');
const { srtToVtt, decodeSrt } = require('../utils/converter');
const { extractSrt, isArchive } = require('../utils/zip');
const { http } = require('../utils/http');
const { validateUrlSync } = require('../utils/url-validator');

// Ephemeral L2 Cache with both entry count and total size limits
const cache = new LRU({
  max: 500,
  maxSize: 50 * 1024 * 1024, // 50MB total cache size
  sizeCalculation: (value) => typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0,
  ttl: 1000 * 60 * 60 * 24  // 24 hours
});

// Maximum allowed subtitle file size (50MB)
const MAX_SUBTITLE_SIZE = 50 * 1024 * 1024;

/**
 * Send an error response with appropriate HTTP status code.
 */
function sendError(res, statusCode, message) {
  const body = message || getDefaultMessage(statusCode);
  res.status(statusCode).send(body);
}

function getDefaultMessage(code) {
  const messages = {
    400: 'Bad request.',
    403: 'Access denied.',
    404: 'Subtitle not found.',
    429: 'Too many requests.',
    502: 'Upstream provider error.',
    504: 'Provider request timed out.',
    500: 'Internal server error.'
  };
  return messages[code] || 'An error occurred.';
}

module.exports = async (req, res) => {
  const { provider, subtitleId, ext } = req.params;
  const isSrt = ext === 'srt';
  const configBase64 = req.query.config;

  // Validate provider name to prevent injection
  const validProviders = ['opensubtitles', 'subdl', 'subsource'];
  if (!validProviders.includes(provider)) {
    return sendError(res, 400, 'Invalid provider.');
  }

  // Validate file extension
  if (ext !== 'srt' && ext !== 'vtt') {
    return sendError(res, 400, 'Invalid file extension. Use .srt or .vtt');
  }

  try {
    // Build cache key including language hint from config
    let langHint = '';
    const cacheKeyPrefix = `${ext}:${provider}:${subtitleId}`;

    if (cache.has(cacheKeyPrefix)) {
      res.setHeader('Content-Type', isSrt ? 'text/plain; charset=utf-8' : 'text/vtt; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      const cached = cache.get(cacheKeyPrefix);
      res.setHeader('Content-Length', Buffer.byteLength(cached, 'utf8'));
      return res.send(cached);
    }

    // Decode and validate config (API keys may be absent - env vars used as fallback)
    let config = {};
    if (configBase64) {
      try {
        config = JSON.parse(Buffer.from(configBase64, 'base64url').toString('utf8'));
      } catch (e) {
        return sendError(res, 400, 'Invalid config parameter.');
      }
    }

    // Decode subtitle ID payload
    let payload;
    try {
      payload = JSON.parse(Buffer.from(subtitleId, 'base64url').toString('utf8'));
    } catch (e) {
      return sendError(res, 400, 'Invalid subtitle ID.');
    }

    // Extract language hint for cache key and archive extraction
    langHint = payload.lang || '';

    const cacheKey = `${ext}:${provider}:${subtitleId}:${langHint}`;
    if (cache.has(cacheKey)) {
      res.setHeader('Content-Type', isSrt ? 'text/plain; charset=utf-8' : 'text/vtt; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      const cached = cache.get(cacheKey);
      res.setHeader('Content-Length', Buffer.byteLength(cached, 'utf8'));
      return res.send(cached);
    }

    let subBuffer;

    switch (provider) {
      case 'opensubtitles': {
        const apiKey = config.opensubtitles_api_key || process.env.OPENSUBTITLES_API_KEY;
        if (!apiKey) {
          logger.error('proxy', 'Missing OpenSubtitles API key (check env var OPENSUBTITLES_API_KEY)');
          return sendError(res, 502, 'OpenSubtitles API key not configured.');
        }

        const dlRes = await http.post(
          'https://api.opensubtitles.com/api/v1/download',
          { file_id: parseInt(payload.id, 10) },
          {
            headers: {
              'Api-Key': apiKey,
              'User-Agent': 'SubtitleHub/1.1.0',
              'Accept': 'application/json'
            }
          }
        );

        if (!dlRes?.data?.link) {
          return sendError(res, 502, 'OpenSubtitles API denied the download link.');
        }

        // Validate the download URL (SSRF protection)
        const urlCheck = validateUrlSync(dlRes.data.link);
        if (!urlCheck.valid) {
          logger.error('proxy', `OpenSubtitles download URL failed validation: ${urlCheck.reason}`);
          return sendError(res, 502, 'Invalid download URL from provider.');
        }

        const fileRes = await http.get(dlRes.data.link, { responseType: 'arraybuffer' });
        subBuffer = Buffer.from(fileRes.data);

        if (subBuffer.length > MAX_SUBTITLE_SIZE) {
          return sendError(res, 502, 'Subtitle file too large.');
        }
        break;
      }

      case 'subdl': {
        const dlUrl = payload.url.startsWith('http')
          ? payload.url
          : `https://dl.subdl.com${payload.url.startsWith('/') ? '' : '/'}${payload.url}`;

        // SSRF protection: validate URL against allowlist
        const urlCheck = validateUrlSync(dlUrl);
        if (!urlCheck.valid) {
          logger.error('proxy', `SubDL URL failed validation: ${urlCheck.reason}`, { url: dlUrl });
          return sendError(res, 403, 'Blocked: URL not in allowed domains.');
        }

        const fileRes = await http.get(encodeURI(dlUrl), { responseType: 'arraybuffer' });
        subBuffer = Buffer.from(fileRes.data);

        if (subBuffer.length > MAX_SUBTITLE_SIZE) {
          return sendError(res, 502, 'Subtitle file too large.');
        }

        // Use shared isArchive utility instead of inline magic byte detection
        if (isArchive(subBuffer)) {
          subBuffer = await extractSrt(subBuffer, payload.lang);
        }
        break;
      }

      case 'subsource': {
        const apiKey = config.subsource_api_key || process.env.SUBSOURCE_API_KEY;

        const dlRes = await http.post('https://api.subsource.net/api/downloadSub', {
          movie: payload.slug,
          lang: payload.lang,
          id: payload.id
        }, { headers: { ...(apiKey && { 'apiKey': apiKey }) } });

        if (!dlRes?.data?.subUrl) {
          return sendError(res, 502, 'SubSource did not return a valid download URL.');
        }

        // Validate the download URL (SSRF protection)
        const urlCheck = validateUrlSync(dlRes.data.subUrl);
        if (!urlCheck.valid) {
          logger.error('proxy', `SubSource download URL failed validation: ${urlCheck.reason}`);
          return sendError(res, 502, 'Invalid download URL from provider.');
        }

        const fileRes = await http.get(dlRes.data.subUrl, { responseType: 'arraybuffer' });
        subBuffer = Buffer.from(fileRes.data);

        if (subBuffer.length > MAX_SUBTITLE_SIZE) {
          return sendError(res, 502, 'Subtitle file too large.');
        }

        // Use shared isArchive utility
        if (isArchive(subBuffer)) {
          subBuffer = await extractSrt(subBuffer, payload.lang);
        }
        break;
      }

      default:
        return sendError(res, 400, 'Unknown provider.');
    }

    const finalContent = isSrt ? decodeSrt(subBuffer, payload.lang) : srtToVtt(subBuffer, payload.lang);

    // Cache the result
    cache.set(cacheKey, finalContent);

    res.setHeader('Content-Type', isSrt ? 'text/plain; charset=utf-8' : 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Length', Buffer.byteLength(finalContent, 'utf8'));
    res.send(finalContent);

  } catch (error) {
    // Differentiated error responses based on error type
    const msg = error.message || '';
    logger.error('proxy', `Failed to serve subtitle: ${msg}`, { provider });

    if (msg.includes('Timeout') || msg.includes('ECONNABORTED')) {
      return sendError(res, 504, 'Provider request timed out.');
    }
    if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('network')) {
      return sendError(res, 502, 'Upstream provider unavailable.');
    }

    return sendError(res, 500);
  }
};
