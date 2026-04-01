'use strict';

const { parseId } = require('../utils/imdb');
const logger = require('../utils/logger');
const { getSupportedLanguages } = require('../config/languages');
const openSubtitles = require('../providers/opensubtitles');
const subdl = require('../providers/subdl');
const subsource = require('../providers/subsource');
const addic7ed = require('../providers/addic7ed');
const { translateBatch } = require('../utils/translation');

const PROVIDERS = {
  opensubtitles: openSubtitles,
  subdl: subdl,
  subsource: subsource,
  addic7ed: addic7ed,
};

// ---------------------------------------------------------------------------
// Provider failover state (in-memory, tracks consecutive failures per source)
// ---------------------------------------------------------------------------
const failoverState = {};

function getFailoverKey(source) { return `failover:${source}`; }

function recordSuccess(source) {
  failoverState[getFailoverKey(source)] = 0;
}

function recordFailure(source) {
  const key = getFailoverKey(source);
  failoverState[key] = (failoverState[key] || 0) + 1;
}

function isProviderHealthy(source) {
  return (failoverState[getFailoverKey(source)] || 0) < 3;
}

/**
 * Get current failover state (for health endpoint reporting).
 * @returns {Object} Map of provider name to consecutive failure count
 */
function getFailoverState() {
  const result = {};
  for (const key of Object.keys(failoverState)) {
    result[key.replace('failover:', '')] = failoverState[key];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Timeout wrapper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Release name matching
// ---------------------------------------------------------------------------

/**
 * Normalize a release name for comparison.
 * Strips quality/source tags and normalizes separators.
 */
function normalizeReleaseName(name) {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/[.\-_]/g, ' ')
    .replace(/\b(webscr|webrip|webdl|web-dl|blueray|bluray|remux|hdtv|hdr|hdcam|cam|ts|proper|repack|internal)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score how well two release names match (0-100).
 * Checks for exact match after normalization, then word overlap.
 */
function releaseMatchScore(subRelease, fileRelease) {
  if (!subRelease || !fileRelease) return 0;
  const normSub = normalizeReleaseName(subRelease);
  const normFile = normalizeReleaseName(fileRelease);
  if (normSub === normFile) return 100;

  // Check for word overlap (only count words longer than 2 chars to avoid noise)
  const subWords = new Set(normSub.split(' ').filter(w => w.length > 2));
  const fileWords = normFile.split(' ').filter(w => w.length > 2);
  const overlap = fileWords.filter(w => subWords.has(w)).length;
  return Math.min(100, Math.round((overlap / Math.max(fileWords.length, 1)) * 100));
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

module.exports = async (args) => {
  try {
    const { type, id, config, extra } = args;
    if (!config) throw new Error("Configuration missing");

    const parsedId = parseId(id);
    let languages = (config.languages || 'eng').split(',').map(l => l.trim().toLowerCase());
    const enabledSources = (config.enabled_sources || 'opensubtitles,subdl,subsource')
      .split(',').map(s => s.trim().toLowerCase());

    // Provider priority order (default: opensubtitles,subdl,subsource,addic7ed)
    const priorityOrder = (config.provider_priority || 'opensubtitles,subdl,subsource,addic7ed')
      .split(',').map(s => s.trim().toLowerCase());

    // Feature toggles
    const includeHI = config.hi_filter === 'true';
    const enableReleaseMatching = config.release_matching === 'true';
    const enableMT = config.mt_fallback === 'true';

    // Prefetch mode: just warm cache, return empty
    if (extra && extra.prefetch) {
      const prefetchPromises = enabledSources
        .filter(source => PROVIDERS[source] && isProviderHealthy(source))
        .map(source => withTimeout(signal => PROVIDERS[source]({ ...args, languages, config }), 5000).catch(() => []));
      await Promise.allSettled(prefetchPromises);
      return { subtitles: [] };
    }

    // Filter unsupported language codes
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
      config,
      title: extra?.show_name || extra?.filename,
    };

    // Execute provider queries with failover
    const promises = enabledSources
      .filter(source => PROVIDERS[source] && isProviderHealthy(source))
      .map(source => {
        return withTimeout(
          (signal) => PROVIDERS[source](fetchParams),
          5000
        )
          .then(results => {
            recordSuccess(source);
            return results;
          })
          .catch(err => {
            recordFailure(source);
            logger.error(source, `Provider failed: ${err.message}`, { imdbId: parsedId.imdbId });
            return [];
          });
      });

    const results = await Promise.all(promises);
    let subtitles = results.flatMap(r => r);

    // HI (Hearing Impaired) filtering — remove if toggle is OFF (default)
    if (!includeHI) {
      subtitles = subtitles.filter(sub => {
        if (sub.releaseName) {
          const rn = sub.releaseName.toLowerCase();
          return !rn.includes('hi.') &&
            !rn.includes('hi ') &&
            !rn.includes('.hi-') &&
            !rn.includes('sdh') &&
            !rn.includes('cc.') &&
            !rn.includes('hearing impaired');
        }
        return true;
      });
    }

    // Release name matching — boost subtitles that match the filename
    const filename = extra?.filename || '';
    if (enableReleaseMatching && filename) {
      subtitles.forEach(sub => {
        sub._matchScore = releaseMatchScore(sub.releaseName, filename);
      });
      subtitles.sort((a, b) => (b._matchScore || 0) - (a._matchScore || 0));
    }

    // Machine translation fallback — if no results for any requested language, translate from English
    if (enableMT && subtitles.length === 0) {
      logger.info('system', 'MT fallback: no subtitles found, attempting translation');
      const mtParams = { ...fetchParams, languages: ['eng'] };
      const mtPromises = enabledSources
        .filter(source => PROVIDERS[source] && isProviderHealthy(source))
        .map(source => withTimeout(signal => PROVIDERS[source](mtParams), 5000).catch(() => []));
      const mtResults = (await Promise.all(mtPromises)).flat();

      if (mtResults.length > 0) {
        const bestSub = mtResults[0];
        const mtPayload = {
          provider: bestSub.provider,
          subtitleId: bestSub.id,
          targetLangs: languages.join(','),
          sourceLang: 'eng',
        };
        const payload = Buffer.from(JSON.stringify(mtPayload)).toString('base64url');

        subtitles.push({
          id: payload,
          lang: languages[0],
          provider: 'machine-translation',
          releaseName: `[MT] ${bestSub.releaseName || 'Translated'}`,
          _isMT: true,
        });
      }
    }

    // Build proxy config with API keys
    const proxyConfig = {
      addon_host: config.addon_host,
      opensubtitles_api_key: config.opensubtitles_api_key || '',
      subdl_api_key: config.subdl_api_key || '',
      subsource_api_key: config.subsource_api_key || '',
    };
    const configBase64 = Buffer.from(JSON.stringify(proxyConfig)).toString('base64url');

    // Sort by provider priority (preserve release-match order for large score differences)
    const priorityMap = {};
    priorityOrder.forEach((p, i) => { priorityMap[p] = i; });
    subtitles.sort((a, b) => {
      if (enableReleaseMatching && filename && a._matchScore !== undefined) {
        if (Math.abs((a._matchScore || 0) - (b._matchScore || 0)) > 20) {
          return (b._matchScore || 0) - (a._matchScore || 0);
        }
      }
      return (priorityMap[a.provider] ?? 99) - (priorityMap[b.provider] ?? 99);
    });

    // Language normalization map (bibliographic → terminological)
    const langNorms = { rum: 'ron', fra: 'fre', deu: 'ger', ell: 'gre', nld: 'dut', ces: 'cze', zho: 'chi' };

    // Format subtitles for Stremio
    const formattedSubtitles = subtitles.map(sub => {
      const host = config.addon_host || 'localhost:7000';
      const protocol = process.env.FORCE_PROTOCOL ||
        (host.includes('localhost') || host.includes('127.0.0.1') || host.includes('[::1]') ? 'http' : 'https');
      const baseUrl = `${protocol}://${host}`;

      let proxyUrl;
      if (sub._isMT) {
        proxyUrl = `${baseUrl}/subtitle/translate/${sub.id}.vtt?config=${configBase64}`;
      } else {
        proxyUrl = `${baseUrl}/subtitle/${sub.provider}/${sub.id}.vtt?config=${configBase64}`;
      }

      // Normalize language codes
      let lang = sub.lang;
      if (langNorms[lang]) lang = langNorms[lang];

      return {
        id: `${sub.provider}-${sub.id}`,
        url: proxyUrl,
        lang,
      };
    });

    return { subtitles: formattedSubtitles };
  } catch (error) {
    logger.error('system', `Handler error: ${error.message}`);
    return { subtitles: [] };
  }
};

// Export helpers for health endpoint
module.exports.getFailoverState = getFailoverState;
