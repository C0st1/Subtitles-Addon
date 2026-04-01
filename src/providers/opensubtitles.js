'use strict';

const { http } = require('../utils/http');
const { toProviderCode, fromProviderCode } = require('../config/languages');
const logger = require('../utils/logger');

module.exports = async (params) => {
  const { imdbId, season, episode, type, languages, config } = params;
  const apiKey = config.opensubtitles_api_key || process.env.OPENSUBTITLES_API_KEY;
  if (!apiKey) return [];

  const osLangs = languages.map(l => toProviderCode(l, 'opensubtitles')).filter(Boolean).join(',');
  if (!osLangs) {
    logger.warn('opensubtitles', 'No supported languages mapped, skipping provider');
    return [];
  }

  const query = new URLSearchParams({
    imdb_id: imdbId,
    languages: osLangs,
    type: type === 'series' ? 'episode' : 'movie'
  });

  if (type === 'series' && season && episode) {
    query.append('season_number', season);
    query.append('episode_number', episode);
  }

  try {
    const res = await http.get(`https://api.opensubtitles.com/api/v1/subtitles?${query.toString()}`, {
      headers: { 'Api-Key': apiKey, 'User-Agent': 'SubtitleHub/1.1.0' }
    });

    const results = [];

    for (const item of res?.data?.data || []) {
      for (const file of item?.attributes?.files || []) {
        const isoLang = fromProviderCode(item.attributes.language, 'opensubtitles');

        // Skip subtitles with unmappable language codes (Stremio expects 3-letter ISO 639-2)
        if (!isoLang) continue;

        const payload = Buffer.from(JSON.stringify({ id: file.file_id })).toString('base64url');

        results.push({
          id: payload,
          lang: isoLang,
          provider: 'opensubtitles',
          releaseName: item.attributes.release
        });
      }
    }

    return results;
  } catch (error) {
    logger.error('opensubtitles', `API request failed: ${error.message}`, { imdbId });
    return [];
  }
};
