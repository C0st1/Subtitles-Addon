'use strict';

const { http } = require('../utils/http');
const { toProviderCode, fromProviderCode } = require('../config/languages');
const logger = require('../utils/logger');

module.exports = async (params) => {
  const { imdbIdFull, season, episode, type, languages, config } = params;
  const apiKey = config.subdl_api_key || process.env.SUBDL_API_KEY;
  if (!apiKey) return [];

  const subdlLangs = languages.map(l => toProviderCode(l, 'subdl')).filter(Boolean).join(',');
  if (!subdlLangs) {
    logger.warn('subdl', 'No supported languages mapped, skipping provider');
    return [];
  }

  const query = new URLSearchParams({
    api_key: apiKey,
    imdb_id: imdbIdFull,
    type: type === 'series' ? 'tv' : 'movie',
    languages: subdlLangs
  });

  if (type === 'series' && season && episode) {
    query.append('season_number', season);
    query.append('episode_number', episode);
  }

  try {
    const res = await http.get(`https://api.subdl.com/api/v1/subtitles?${query.toString()}`);

    const results = [];
    for (const sub of res.data.subtitles || []) {
      const isoLang = fromProviderCode(sub.language, 'subdl');
      if (!isoLang) continue;

      const payload = Buffer.from(JSON.stringify({ url: sub.url })).toString('base64url');
      results.push({
        id: payload,
        lang: isoLang,
        provider: 'subdl',
        releaseName: sub.release_name,
        downloads: sub.download_count || 0,
      });
    }

    return results;
  } catch (error) {
    logger.error('subdl', `API request failed: ${error.message}`, { imdbIdFull });
    return [];
  }
};
