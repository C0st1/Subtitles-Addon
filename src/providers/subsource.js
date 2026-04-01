const { http } = require('../utils/http');
const { toProviderCode, fromProviderCode } = require('../config/languages');
const axios = require('axios');

/**
 * SubSource Provider
 * Optimized to skip Cinemeta resolution if title is provided in params.
 */
module.exports = async (params) => {
  const { imdbIdFull, season, type, languages, config, title: providedTitle } = params;
  const apiKey = config.subsource_api_key || process.env.SUBSOURCE_API_KEY;
  
  const ssLangs = languages.map(l => toProviderCode(l, 'subsource')).filter(Boolean);
  if (!ssLangs.length) return [];

  let title = providedTitle;
  if (!title) {
    try {
      const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${imdbIdFull}.json`, { timeout: 3000 });
      title = metaRes.data.meta.name;
    } catch (e) {
      return []; // Return empty if title cannot be resolved
    }
  }

  if (!title) return [];

  const headers = apiKey ? { 'apiKey': apiKey } : {};

  try {
    const searchRes = await http.post('https://api.subsource.net/api/searchMovie', { query: title }, { headers });
    
    const match = searchRes?.data?.found?.find(m => m.title?.toLowerCase() === title.toLowerCase());
    if (!match) return [];

    const movieSlug = match.folderName;

    const getRes = await http.post('https://api.subsource.net/api/getMovie', {
      movieName: movieSlug,
      langs: ssLangs,
      season: type === 'series' ? season : undefined
    }, { headers });

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
    return [];
  }
};
