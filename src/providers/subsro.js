const { http } = require('../utils/http');
const { toProviderCode, fromProviderCode } = require('../config/languages');
module.exports = async (params) => {
  const { imdbIdFull, type, season, episode, languages, config } = params;
  const apiKey = config.subsro_api_key || process.env.SUBSRO_API_KEY;
  if (!apiKey) return [];

  const requestedSubsroLangs = languages.map(l => toProviderCode(l, 'subsro')).filter(Boolean);
  if (!requestedSubsroLangs.length) return [];

  try {
    const res = await http.get(`https://api.subs.ro/v1.0/search/imdbid/${imdbIdFull}`, {
      params: { language: requestedSubsroLangs[0] }, // Optional: filter by first language
      headers: { 
        'X-Subs-Api-Key': apiKey,
        'User-Agent': 'SubtitleAggregator v1.0.0', 
        'Accept': 'application/json' 
      }
    });

    const results = [];
    
    // FIX: Access the 'items' array from the response object
    const items = res.data && res.data.items ? res.data.items : [];

    for (const sub of items) {
      // Filtering for TV shows
      if (type === 'series') {
        // Note: Check if the API provides season/episode in the search result 
        // Some APIs only provide this in 'details'. If missing, you may need a second call.
        if (sub.season && (parseInt(sub.season) !== parseInt(season) || parseInt(sub.episode) !== parseInt(episode))) {
          continue;
        }
      }

      const isoLang = fromProviderCode(sub.language, 'subsro');
      // The API uses 'title' or 'description' for the release name/title
      const releaseName = sub.title || sub.description || 'Unknown Release';

      const payload = Buffer.from(JSON.stringify({ id: sub.id })).toString('base64url');
      results.push({
        id: payload,
        lang: isoLang || 'ron', // Default to Romanian if mapping fails
        provider: 'subsro',
        releaseName: releaseName
      });
    }
    return results;
  } catch (err) {
    logger.error('subsro', `API Error: ${err.message}`);
    return [];
  }
};
