const { http } = require('../utils/http');
const { toProviderCode, fromProviderCode } = require('../config/languages');

module.exports = async (params) => {
  const { imdbId, languages, config } = params;
  const apiKey = config.subsro_api_key || process.env.SUBSRO_API_KEY;
  if (!apiKey) return[];

  // Subs.ro primarily serves Romanian, but we check if requested languages match
  const requestedSubsroLangs = languages.map(l => toProviderCode(l, 'subsro')).filter(Boolean);
  if (!requestedSubsroLangs.length) return[];

  const res = await http.get(`https://api.subs.ro/v1.0/search/imdbid/${imdbId}?language=ro`, {
    headers: { 'X-Subs-Api-Key': apiKey }
  });

  const results = [];
  for (const sub of res.data ||[]) {
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
