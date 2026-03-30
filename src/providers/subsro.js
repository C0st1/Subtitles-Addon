const { http } = require('../utils/http');
const { toProviderCode, fromProviderCode } = require('../config/languages');
const logger = require('../utils/logger');

module.exports = async (params) => {
  // 1. Destructure parameters
  const { imdbIdFull, type, season, episode, languages, config } = params;
  const apiKey = config.subsro_api_key || process.env.SUBSRO_API_KEY;
  
  if (!apiKey) return [];

  // Map requested languages to Subs.ro provider codes
  const requestedSubsroLangs = languages.map(l => toProviderCode(l, 'subsro')).filter(Boolean);
  if (!requestedSubsroLangs.length) return [];

  try {
    // The API documentation specifies searching by imdbid returns a SearchResponse object
    const res = await http.get(`https://api.subs.ro/v1.0/search/imdbid/${imdbIdFull}`, {
      headers: { 
        'X-Subs-Api-Key': apiKey,
        'User-Agent': 'SubtitleAggregator v1.0.0', 
        'Accept': 'application/json' 
      }
    });

    const results = [];
    
    /** * CRITICAL FIX: The Subs.ro API returns a SearchResponse object where 
     * the subtitles are located in an 'items' array.
     */
    const items = res.data && res.data.items ? res.data.items : [];

    for (const sub of items) {
      // 2. Add filtering for TV shows if applicable
      if (type === 'series') {
        // Only filter if the provider provides season/episode metadata in the search results
        if (sub.season && sub.episode) {
          if (parseInt(sub.season) !== parseInt(season) || parseInt(sub.episode) !== parseInt(episode)) {
            continue;
          }
        }
      }

      const isoLang = fromProviderCode(sub.language, 'subsro');
      
      // Ensure the language is one of the user's requested languages
      if (!isoLang || !requestedSubsroLangs.includes(sub.language)) continue;

      /**
       * To show multiple versions in Stremio, we use the 'title' or 'description' 
       * from the API which usually contains strings like "1080p", "4K", or "HDR".
       */
      const releaseName = sub.title || sub.description || 'Unknown Release';

      // Payload contains the ID needed for the download proxy
      const payload = Buffer.from(JSON.stringify({ 
        id: sub.id,
        isZip: true // Hint to the proxy that this might be an archive
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
