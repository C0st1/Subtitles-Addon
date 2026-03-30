const { http } = require('../utils/http');
const { toProviderCode, fromProviderCode } = require('../config/languages');
const logger = require('../utils/logger');
const { listSrtFiles } = require('../utils/zip');

module.exports = async (params) => {
  const { imdbIdFull, type, season, episode, languages, config } = params;
  const apiKey = config.subsro_api_key || process.env.SUBSRO_API_KEY;
  if (!apiKey) return [];

  const requestedLangs = languages.map(l => toProviderCode(l, 'subsro')).filter(Boolean);
  if (!requestedLangs.length) return [];

  try {
    const res = await http.get(`https://api.subs.ro/v1.0/search/imdbid/${imdbIdFull}`, {
      headers: { 'X-Subs-Api-Key': apiKey },
      timeout: 5000 // 5s search timeout
    });

    const items = res.data?.items || [];
    const results = [];

    for (const sub of items) {
      if (type === 'series' && (sub.season != season || sub.episode != episode)) continue;
      const isoLang = fromProviderCode(sub.language, 'subsro');
      if (!isoLang || !requestedLangs.includes(sub.language)) continue;

      try {
        // Fetch ZIP to find the 4 versions
        const dl = await http.get(`https://api.subs.ro/v1.0/subtitle/${sub.id}/download`, {
          headers: { 'X-Subs-Api-Key': apiKey },
          responseType: 'arraybuffer',
          timeout: 8000 // Don't let a slow ZIP kill the app
        });

        const files = await listSrtFiles(Buffer.from(dl.data));

        for (const file of files) {
          results.push({
            id: Buffer.from(JSON.stringify({ id: sub.id, fileName: file.name })).toString('base64url'),
            lang: isoLang,
            provider: 'subsro',
            releaseName: file.name.split('/').pop() // Show "2160p", "1080p", etc.
          });
        }
      } catch (e) {
        // Fallback: Show at least one generic entry if ZIP fails
        results.push({
          id: Buffer.from(JSON.stringify({ id: sub.id, fileName: sub.title })).toString('base64url'),
          lang: isoLang,
          provider: 'subsro',
          releaseName: sub.title
        });
      }
    }
    return results;
  } catch (err) {
    return [];
  }
};
