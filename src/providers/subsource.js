'use strict';

const { http } = require('../utils/http');
const { toProviderCode, fromProviderCode } = require('../config/languages');
const logger = require('../utils/logger');

const SUBSOURCE_API_BASE = 'https://api.subsource.net/api/v1';

/**
 * SubSource Provider (v1 API)
 *
 * SubSource migrated from their old POST-based API to a proper REST v1 API.
 * Key changes from the old API:
 *   - Auth header: `X-API-Key` (was `apiKey`)
 *   - Search: GET by IMDB ID (was POST with title)
 *   - Subtitles: paginated GET with full language names
 *   - Download: returns ZIP directly (was a URL to follow)
 *
 * Language codes use full lowercase English names: "english", "romanian", etc.
 * (already mapped correctly in config/languages.js)
 */
module.exports = async (params) => {
  const { imdbIdFull, season, episode, type, languages, config } = params;
  const apiKey = config.subsource_api_key || process.env.SUBSOURCE_API_KEY;

  if (!apiKey) {
    logger.warn('subsource', 'No API key configured, skipping provider');
    return [];
  }

  const ssLangs = languages.map(l => toProviderCode(l, 'subsource')).filter(Boolean);
  if (!ssLangs.length) {
    logger.warn('subsource', 'No supported languages mapped, skipping provider');
    return [];
  }

  const headers = {
    'X-API-Key': apiKey,
    'Accept': 'application/json',
  };

  try {
    // Step 1: Search by IMDB ID to get movieId
    const searchRes = await http.get(`${SUBSOURCE_API_BASE}/movies/search`, {
      params: { searchType: 'imdb', imdb: imdbIdFull },
      headers,
      timeout: 8000,
    });

    const movieData = searchRes?.data?.data;
    if (!movieData) {
      logger.warn('subsource', `No results found for IMDB: ${imdbIdFull}`);
      return [];
    }

    // Movies: single object with movieId
    // Series: array of objects, one per season, each with movieId + season number
    let movieId;

    if (Array.isArray(movieData)) {
      // TV series — find matching season
      if (type === 'series' && season) {
        const seasonNum = parseInt(season, 10);
        const seasonMatch = movieData.find(m => m.season === seasonNum);
        movieId = seasonMatch ? seasonMatch.movieId : movieData[0]?.movieId;
      } else {
        movieId = movieData[0]?.movieId;
      }
    } else {
      movieId = movieData.movieId;
    }

    if (!movieId) {
      logger.warn('subsource', `Could not resolve movieId for IMDB: ${imdbIdFull}`);
      return [];
    }

    // Step 2: Fetch subtitles for each requested language
    const results = [];

    for (const ssLang of ssLangs) {
      try {
        let page = 1;
        let hasMore = true;

        while (hasMore) {
          const subsRes = await http.get(`${SUBSOURCE_API_BASE}/subtitles`, {
            params: {
              movieId,
              limit: 100,
              page,
              language: ssLang,
            },
            headers,
            timeout: 8000,
          });

          // Handle response structure: { data: { subtitles: [...], pagination: { pages: N } } }
          // or flat: { data: [...] }
          const responseData = subsRes?.data?.data;
          let subtitles = [];
          let pagination = null;

          if (Array.isArray(responseData)) {
            subtitles = responseData;
          } else if (responseData && typeof responseData === 'object') {
            subtitles = responseData.subtitles || [];
            pagination = responseData.pagination || null;
          }

          for (const sub of subtitles) {
            if (!sub.subtitleId) continue;

            const isoLang = fromProviderCode(ssLang, 'subsource') || fromProviderCode(sub.language, 'subsource');
            if (!isoLang) continue;

            const payload = Buffer.from(JSON.stringify({ subtitleId: String(sub.subtitleId) })).toString('base64url');

            const rawRelease = sub.releaseInfo ?? sub.releaseName ?? '';
            const releaseName = typeof rawRelease === 'string' ? rawRelease : (rawRelease != null ? String(rawRelease) : '');

            results.push({
              id: payload,
              lang: isoLang,
              provider: 'subsource',
              releaseName,
              downloads: sub.downloads || 0,
            });
          }

          // Pagination
          if (pagination && pagination.pages && page < pagination.pages) {
            page++;
          } else {
            hasMore = false;
          }
        }
      } catch (err) {
        logger.warn('subsource', `Failed to fetch ${ssLang} subtitles: ${err.message}`);
      }
    }

    return results;
  } catch (error) {
    logger.error('subsource', `API request failed: ${error.message}`, { imdbId: imdbIdFull });
    return [];
  }
};
