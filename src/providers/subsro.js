const { http } = require('../utils/http');
const { toProviderCode, fromProviderCode } = require('../config/languages');

module.exports = async (params) => {
  // Destructure type, season, episode, and imdbIdFull (which includes the "tt" prefix)
  const { imdbIdFull, type, season, episode, languages, config } = params;
  const apiKey = config.subsro_api_key || process.env.SUBSRO_API_KEY;
  if (!apiKey) return [];

  const requestedSubsroLangs = languages.map(l => toProviderCode(l, 'subsro')).filter(Boolean);
  if (!requestedSubsroLangs.length) return [];

  // 1. Fetch from API with bypassed headers and the full IMDb ID (e.g., tt29567915)
  const res = await http.get(`https://api.subs.ro/v1.0/search/imdbid/${imdbIdFull}?language=ro`, {
    headers: { 
      'X-Subs-Api-Key': apiKey,
      // CRITICAL: Override the fake Chrome headers to bypass Cloudflare 403
      'User-Agent': 'SubtitleAggregator v1.0.0', 
      'Accept': 'application/json' 
    }
  });

  // (Optional) Temporary logging to Vercel to see what the API returns if it still fails
  console.log(`SUBSRO RESPONSE for ${imdbIdFull}:`, JSON.stringify(res.data).substring(0, 300));

  // 2. UNWRAP THE JSON ENVELOPE
  // Subs.ro might wrap the subtitles array inside an object instead of returning a raw array.
  let subsArray = [];
  if (Array.isArray(res.data)) {
    subsArray = res.data;
  } else if (res.data && Array.isArray(res.data.data)) {
    subsArray = res.data.data;
  } else if (res.data && Array.isArray(res.data.collection)) {
    subsArray = res.data.collection;
  } else if (res.data && Array.isArray(res.data.subtitles)) {
    subsArray = res.data.subtitles;
  } else {
    // If it's none of the above, the API couldn't find the movie or returned an error object
    return [];
  }

  const results = [];
  
  // 3. Loop over our safely extracted array
  for (const sub of subsArray) {
    // Add filtering for TV shows so we don't return every episode's subtitles
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
