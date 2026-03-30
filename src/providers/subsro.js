const { http } = require('../utils/http');
const { toProviderCode, fromProviderCode } = require('../config/languages');

module.exports = async (params) => {
  // 1. Destructure type, season, episode, and imdbIdFull
  const { imdbId, imdbIdFull, type, season, episode, languages, config } = params;
  const apiKey = config.subsro_api_key || process.env.SUBSRO_API_KEY;
  if (!apiKey) return [];

  const requestedSubsroLangs = languages.map(l => toProviderCode(l, 'subsro')).filter(Boolean);
  if (!requestedSubsroLangs.length) return [];

// Try using imdbIdFull (e.g. tt29567915) if imdbId (29567915) still throws a 404 or 403 after fixing headers
  const res = await http.get(`https://api.subs.ro/v1.0/search/imdbid/${imdbIdFull}?language=ro`, {
    headers: { 
      'X-Subs-Api-Key': apiKey,
      'User-Agent': 'SubtitleAggregator v1.0.0', 
      'Accept': 'application/json' 
    }
  });

  const results = [];
  
  // CRITICAL FIX: Ensure the response is an array before trying to loop
  // If the API returns an error object, we gracefully return an empty array instead of crashing.
  if (!Array.isArray(res.data)) {
    return [];
  }

  for (const sub of res.data) {
    // 2. Add filtering for TV shows
    if (type === 'series') {
      if (parseInt(sub.season) !== parseInt(season) || parseInt(sub.episode) !== parseInt(episode)) {
        continue;
      }
    }

    const isoLang = fromProviderCode(sub.language, 'subsro');
    if (!isoLang || !requestedSubsroLangs.includes(sub.language)) continue;

    const payload = Buffer.from(JSON.stringify({ id: sub.id })).toString('base64url');
    results.push({
      id: payload,
      lang: isoLang,
      provider: 'subsro',
      releaseName: sub.release
    });
  }
  return results;
};
