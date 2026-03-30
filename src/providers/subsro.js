const { http } = require('../utils/http');
const { toProviderCode, fromProviderCode } = require('../config/languages');
const logger = require('../utils/logger');
const { listSrtFiles } = require('../utils/zip'); // Import the zipper utility

/**
 * Subs.ro Provider - Multi-file Fix
 * Fetches and expands ZIP contents so every version appears in Stremio.
 */
module.exports = async (params) => {
  const { imdbIdFull, type, season, episode, languages, config } = params;
  const apiKey = config.subsro_api_key || process.env.SUBSRO_API_KEY;
  
  if (!apiKey) return [];

  const requestedSubsroLangs = languages.map(l => toProviderCode(l, 'subsro')).filter(Boolean);
  if (!requestedSubsroLangs.length) return [];

  try {
    const res = await http.get(`https://api.subs.ro/v1.0/search/imdbid/${imdbIdFull}`, {
      headers: { 
        'X-Subs-Api-Key': apiKey,
        'User-Agent': 'SubtitleAggregator v1.0.0', 
        'Accept': 'application/json' 
      }
    });

    const results = [];
    const items = res.data && res.data.items ? res.data.items : [];

    for (const sub of items) {
      // Filter for TV shows
      if (type === 'series' && sub.season && sub.episode) {
        if (parseInt(sub.season) !== parseInt(season) || parseInt(sub.episode) !== parseInt(episode)) {
          continue;
        }
      }

      const isoLang = fromProviderCode(sub.language, 'subsro');
      if (!isoLang || !requestedSubsroLangs.includes(sub.language)) continue;

      try {
        // Fetch the actual archive to see what's inside
        const downloadRes = await http.get(`https://api.subs.ro/v1.0/subtitle/${sub.id}/download`, {
          headers: { 'X-Subs-Api-Key': apiKey },
          responseType: 'arraybuffer'
        });

        const filesInZip = await listSrtFiles(Buffer.from(downloadRes.data));

        // Create a separate Stremio result for every SRT file in the ZIP
        for (const file of filesInZip) {
          const payload = Buffer.from(JSON.stringify({ 
            id: sub.id, 
            fileName: file.name // Store the specific internal filename
          })).toString('base64url');
          
          results.push({
            id: payload,
            lang: isoLang,
            provider: 'subsro',
            // Use the internal filename (e.g. Agent.Zeta.2160p...) so the user can choose
            releaseName: file.name.split('/').pop() 
          });
        }
      } catch (zipError) {
        // Fallback if ZIP reading fails: push the generic entry
        const payload = Buffer.from(JSON.stringify({ id: sub.id, fileName: sub.title })).toString('base64url');
        results.push({
          id: payload,
          lang: isoLang,
          provider: 'subsro',
          releaseName: sub.title || 'Unknown Release'
        });
      }
    }
    
    return results;
  } catch (error) {
    logger.error('subsro', `Provider search failed: ${error.message}`, { imdbId: imdbIdFull });
    return [];
  }
};
