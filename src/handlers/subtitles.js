'use strict';

const { parseId } = require('../utils/imdb');
const logger = require('../utils/logger');
const { getSupportedLanguages } = require('../config/languages');
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
    let languages = (config.languages || 'eng').split(',').map(l => l.trim().toLowerCase());
    const enabledSources = (config.enabled_sources || 'opensubtitles,subdl,subsource')
      .split(',').map(s => s.trim().toLowerCase());

    // Filter unsupported language codes (FIX: remove before passing to providers)
    const supported = getSupportedLanguages();
    const unsupported = languages.filter(l => !supported.includes(l) && !supported.includes(l.substring(0, 3)));
    if (unsupported.length > 0) {
      logger.warn('system', `Unsupported language codes removed: ${unsupported.join(', ')}`);
    }
    languages = languages.filter(l => supported.includes(l) || supported.includes(l.substring(0, 3)));

    if (languages.length === 0) {
      logger.warn('system', 'No valid languages remaining after filtering');
      return { subtitles: [] };
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

    // Build proxy config with API keys (required for subtitle downloads).
    // The proxy config is base64-encoded and passed as a query parameter.
    // This is the standard Stremio config-via-URL architecture.
    const proxyConfig = {
      addon_host: config.addon_host,
      opensubtitles_api_key: config.opensubtitles_api_key || '',
      subdl_api_key: config.subdl_api_key || '',
      subsource_api_key: config.subsource_api_key || '',
    };

    const configBase64 = Buffer.from(JSON.stringify(proxyConfig)).toString('base64url');

    const formattedSubtitles = subtitles.map(sub => {
      const host = config.addon_host || 'localhost:7000';
      const protocol = process.env.FORCE_PROTOCOL ||
        (host.includes('localhost') || host.includes('127.0.0.1') || host.includes('[::1]') ? 'http' : 'https');
      const baseUrl = `${protocol}://${host}`;

      const proxyUrl = `${baseUrl}/subtitle/${sub.provider}/${sub.id}.vtt?config=${configBase64}`;

      // Normalize bibliographic codes to terminological codes (e.g. rum -> ron)
      // to prevent duplicate language tabs in Stremio
      let lang = sub.lang;
      if (lang === 'rum') lang = 'ron';
      if (lang === 'fra') lang = 'fre';
      if (lang === 'deu') lang = 'ger';
      if (lang === 'ell') lang = 'gre';
      if (lang === 'nld') lang = 'dut';
      if (lang === 'ces') lang = 'cze';
      if (lang === 'zho') lang = 'chi';

      return {
        id: `${sub.provider}-${sub.id}`,
        url: proxyUrl,
        lang
      };
    });

    return { subtitles: formattedSubtitles };
  } catch (error) {
    logger.error('system', `Handler error: ${error.message}`);
    return { subtitles: [] };
  }
};
