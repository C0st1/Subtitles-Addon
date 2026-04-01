'use strict';

const { parseId } = require('../utils/imdb');
const logger = require('../utils/logger');
const openSubtitles = require('../providers/opensubtitles');
const subdl = require('../providers/subdl');
const subsource = require('../providers/subsource');

const PROVIDERS = {
  opensubtitles: openSubtitles,
  subdl: subdl,
  subsource: subsource,
};

/**
 * Wraps a promise with AbortController-based timeout.
 * Unlike Promise.race, this actually cancels the underlying HTTP request on timeout.
 * @param {Function} fn - Async function that receives an AbortSignal
 * @param {number} ms - Timeout in milliseconds
 * @returns {Promise}
 */
async function withTimeout(fn, ms) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);

  try {
    return await fn(controller.signal);
  } catch (error) {
    if (error.name === 'CanceledError' || error.name === 'AbortError') {
      throw new Error(`Timeout after ${ms}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = async (args) => {
  try {
    const { type, id, config } = args;
    if (!config) throw new Error("Configuration missing");

    const parsedId = parseId(id);
    const languages = (config.languages || 'eng').split(',').map(l => l.trim().toLowerCase());
    const enabledSources = (config.enabled_sources || 'opensubtitles,subdl,subsource')
      .split(',').map(s => s.trim().toLowerCase());

    // Log warning for unsupported languages
    const { getSupportedLanguages } = require('../config/languages');
    const supported = getSupportedLanguages();
    const unsupported = languages.filter(l => !supported.includes(l) && !supported.includes(l.substring(0, 3)));
    if (unsupported.length > 0) {
      logger.warn('system', `Unsupported language codes ignored: ${unsupported.join(', ')}`);
    }

    const fetchParams = {
      ...parsedId,
      type,
      languages,
      config,  // Full config (with API keys) for provider queries
      title: args.extra?.show_name || args.extra?.filename
    };

    // Execute provider queries with AbortController-based timeouts
    const promises = enabledSources
      .filter(source => PROVIDERS[source])
      .map(source => {
        return withTimeout(
          (signal) => PROVIDERS[source](fetchParams),
          5000
        ).catch(err => {
          logger.error(source, `Provider failed: ${err.message}`, { imdbId: parsedId.imdbId });
          return []; // Fail gracefully
        });
      });

    const results = await Promise.all(promises);
    const subtitles = results.flatMap(r => r);

    // Encode full config into subtitle proxy URLs so the proxy can use API keys
    // Note: API keys in URLs is inherent to Stremio's config-via-URL architecture.
    // For server-only deployments, set API keys as environment variables as fallback.
    const configBase64 = Buffer.from(JSON.stringify(config)).toString('base64url');

    const formattedSubtitles = subtitles.map(sub => {
      const host = config.addon_host || 'localhost:7000';
      const protocol = process.env.FORCE_PROTOCOL ||
        (host.includes('localhost') || host.includes('127.0.0.1') || host.includes('[::1]') ? 'http' : 'https');
      const baseUrl = `${protocol}://${host}`;

      const proxyUrl = `${baseUrl}/subtitle/${sub.provider}/${sub.id}.vtt?config=${configBase64}`;

      return {
        id: `${sub.provider}-${sub.id}`,
        url: proxyUrl,
        lang: sub.lang
      };
    });

    return { subtitles: formattedSubtitles };
  } catch (error) {
    logger.error('system', `Handler error: ${error.message}`);
    return { subtitles: [] };
  }
};
