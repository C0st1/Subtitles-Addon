const { http } = require('../utils/http');
const { toProviderCode, fromProviderCode } = require('../config/languages');
const axios = require('axios');

module.exports = async (params) => {
  const { imdbIdFull, season, type, languages, config } = params;
  const apiKey = config.subsource_api_key || process.env.SUBSOURCE_API_KEY;
  
  const ssLangs = languages.map(l => toProviderCode(l, 'subsource')).filter(Boolean);
  if (!ssLangs.length) return[];

  // Resolve IMDb ID to Title using Stremio's free Cinemeta API
  let title;
  try {
    const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${imdbIdFull}.json`);
    title = metaRes.data.meta.name;
  } catch (e) {
    return[]; // Cannot resolve title
  }

  const headers = apiKey ? { 'apiKey': apiKey } : {};

  // Search for the movie/show slug
  const searchRes = await http.post('https://api.subsource.net/api/searchMovie', { query: title }, { headers });
  const match = searchRes.data.found.find(m => m.title.toLowerCase() === title.toLowerCase());
  if (!match) return[];

  const movieSlug = match.folderName;

  // Get subtitles
  const getRes = await http.post('https://api.subsource.net/api/getMovie', {
    movieName: movieSlug,
    langs: ssLangs,
    season: type === 'series' ? season : undefined
  }, { headers });

  const results = [];
  for (const sub of getRes.data.subs ||[]) {
    const isoLang = fromProviderCode(sub.lang, 'subsource');
    if (!isoLang) continue;

    const payload = Buffer.from(JSON.stringify({ id: sub.subId, slug: movieSlug, lang: sub.lang })).toString('base64url');
    results.push({
      id: payload,
      lang: isoLang,
      provider: 'subsource',
      releaseName: sub.releaseName
    });
  }
  return results;
};
