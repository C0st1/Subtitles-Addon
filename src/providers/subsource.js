'use strict';

const { http } = require('../utils/http');
const { toProviderCode, fromProviderCode } = require('../config/languages');
const logger = require('../utils/logger');

/**
 * Normalize a title for fuzzy comparison.
 * Removes year suffixes like (2024), leading/trailing whitespace, and common articles.
 * @param {string} title
 * @returns {string}
 */
function normalizeTitle(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s*\(\d{4}\)\s*$/, '')   // Remove year suffix: "The Matrix (1999)" -> "the matrix"
    .replace(/^the\s+/i, '')            // Remove leading "The"
    .replace(/^a\s+/i, '')             // Remove leading "A"
    .replace(/^an\s+/i, '')            // Remove leading "An"
    .replace(/['']/g, '')              // Remove curly/smart quotes
    .replace(/[^a-z0-9\s]/g, '')       // Remove non-alphanumeric except spaces
    .replace(/\s+/g, ' ')              // Normalize whitespace
    .trim();
}

/**
 * SubSource Provider
 * Queries SubSource API for subtitles. Falls back to Cinemeta for title resolution.
 */
module.exports = async (params) => {
  const { imdbIdFull, season, type, languages, config, title: providedTitle } = params;
  const apiKey = config.subsource_api_key || process.env.SUBSOURCE_API_KEY;

  const ssLangs = languages.map(l => toProviderCode(l, 'subsource')).filter(Boolean);
  if (!ssLangs.length) {
    logger.warn('subsource', 'No supported languages mapped, skipping provider');
    return [];
  }

  let title = providedTitle;
  if (!title) {
    try {
      // Use shared http client instead of raw axios (consistent timeout, User-Agent, connection pooling)
      const metaRes = await http.get(
        `https://v3-cinemeta.strem.io/meta/${type}/${imdbIdFull}.json`
      );
      title = metaRes.data?.meta?.name;
    } catch (e) {
      logger.warn('subsource', `Cinemeta lookup failed: ${e.message}`);
      return [];
    }
  }

  if (!title) return [];

  const headers = apiKey ? { 'apiKey': apiKey } : {};

  try {
    const searchRes = await http.post(
      'https://api.subsource.net/api/searchMovie',
      { query: title },
      { headers }
    );

    // Fuzzy title matching: try exact match first, then normalized comparison
    const found = searchRes?.data?.found || [];
    const normalizedTitle = normalizeTitle(title);
    let match = found.find(m => m.title?.toLowerCase() === title.toLowerCase());

    if (!match) {
      match = found.find(m => normalizeTitle(m.title) === normalizedTitle);
    }

    if (!match) return [];

    const movieSlug = match.folderName;

    const getRes = await http.post(
      'https://api.subsource.net/api/getMovie',
      {
        movieName: movieSlug,
        langs: ssLangs,
        season: type === 'series' ? season : undefined
      },
      { headers }
    );

    const results = [];

    for (const sub of getRes?.data?.subs || []) {
      const isoLang = fromProviderCode(sub.lang, 'subsource');
      if (!isoLang) continue;

      const payload = Buffer.from(JSON.stringify({
        id: sub.subId,
        slug: movieSlug,
        lang: sub.lang
      })).toString('base64url');

      results.push({
        id: payload,
        lang: isoLang,
        provider: 'subsource',
        releaseName: sub.releaseName
      });
    }

    return results;
  } catch (error) {
    logger.error('subsource', `API request failed: ${error.message}`, { title });
    return [];
  }
};
