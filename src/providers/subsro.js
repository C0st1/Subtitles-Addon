const { http } = require('../utils/http');
const { toProviderCode, fromProviderCode } = require('../config/languages');
const logger = require('../utils/logger');

/**
 * Subs.ro Provider
 * Fetches subtitle results from api.subs.ro and formats them for Stremio.
 */
module.exports = async (params) => {
  // 1. Destructure parameters
  const { imdbIdFull, type, season, episode, languages, config } = params;
  const apiKey = config.subsro_api_key || process.env.SUBSRO_API_KEY;
  
  if (!apiKey) return [];

  // Map requested languages to Subs.ro provider codes
  const requestedSubsroLangs = languages.map(l => toProviderCode(l, 'subsro')).filter(Boolean);
  if (!requestedSubsroLangs.length) return [];

  try {
    // Search by IMDB ID as specified in the Subs.ro API documentation
    const res = await http.get(`https://api.subs.ro/v1.0/search/imdbid/${imdbIdFull}`, {
      headers: { 
        'X-Subs-Api-Key': apiKey,
        'User-Agent': 'SubtitleAggregator v1.0.0', 
        'Accept': 'application/json' 
      }
    });

    const results = [];
    
    // The API returns a SearchResponse object where subtitles are in the 'items' array
    const items = res.data && res.data.items ? res.data.items : [];

    for (const sub of items) {
      // 2. Filter for TV shows if applicable
      if (type === 'series') {
        if (sub.season && sub.episode) {
          if (parseInt(sub.season) !== parseInt(season) || parseInt(sub.episode) !== parseInt(episode)) {
            continue;
          }
        }
      }

      const isoLang = fromProviderCode(sub.language, 'subsro');
      
      // Ensure the language is one of the user's requested languages
      if (!isoLang || !requestedSubsroLangs.includes(sub.language)) continue;

      /** * UPDATED: Include fileName in the payload.
       * This allows the subtitle-proxy to match the correct file inside the ZIP 
       * when there are multiple versions (1080p, 4K, etc.) available.
       */
      const releaseName = sub.title || sub.description || 'Unknown Release';
      const payload = Buffer.from(JSON.stringify({ 
        id: sub.id, 
        fileName: releaseName 
      })).toString('base64url');
      
      results.push({
        id: payload,
        lang: isoLang,
        provider: 'subsro',
        releaseName: releaseName
      });
    }
    
    return results;
  } catch (error) {
    logger.error('subsro', `Provider search failed: ${error.message}`, { imdbId: imdbIdFull });
    return [];
  }
};
