const { http } = require('../utils/http');
const { toProviderCode, fromProviderCode } = require('../config/languages');
const logger = require('../utils/logger');
const { listSrtFiles } = require('../utils/zip');

/**
 * Subs.ro Provider
 * Fetches subtitle archives, downloads them in parallel, 
 * and extracts individual .srt files to display as separate Stremio results.
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

    const items = res.data && res.data.items ? res.data.items : [];
    
    // Fetch ZIPs in parallel to avoid hitting Stremio's timeout limit
    const zipPromises = items.map(async (sub) => {
      // Filter for TV shows
      if (type === 'series' && sub.season && sub.episode) {
        if (parseInt(sub.season) !== parseInt(season) || parseInt(sub.episode) !== parseInt(episode)) {
          return [];
        }
      }

      const isoLang = fromProviderCode(sub.language, 'subsro');
      if (!isoLang || !requestedSubsroLangs.includes(sub.language)) return [];

      try {
        // Download the ZIP archive right now during the search
        const dlRes = await http.get(`https://api.subs.ro/v1.0/subtitle/${sub.id}/download`, {
          headers: { 
            'X-Subs-Api-Key': apiKey,
            'User-Agent': 'SubtitleAggregator v1.0.0'
          },
          responseType: 'arraybuffer'
        });

        const fileBuffer = Buffer.from(dlRes.data);
        const srtFiles = await listSrtFiles(fileBuffer);
        const fileResults = [];

        // Loop through the ZIP and create a Stremio entry for EVERY file
        for (const file of srtFiles) {
          const payload = Buffer.from(JSON.stringify({ 
            id: sub.id, 
            fileName: file.name // Pass the exact inner file name
          })).toString('base64url');
          
          fileResults.push({
            id: payload,
            lang: isoLang,
            provider: 'subsro',
            // Clean up the name for Stremio UI (remove .srt extension)
            releaseName: file.name.replace(/\.srt$/i, '')
          });
        }
        return fileResults;

      } catch (err) {
        // If downloading the ZIP fails, fallback to pushing the generic archive name
        logger.warn('subsro', `Could not peek into archive ${sub.id}, falling back to generic name.`, { error: err.message });
        const fallbackName = sub.title || sub.description || 'Unknown Release';
        const payload = Buffer.from(JSON.stringify({ id: sub.id, fileName: fallbackName })).toString('base64url');
        
        return [{
          id: payload,
          lang: isoLang,
          provider: 'subsro',
          releaseName: fallbackName
        }];
      }
    });

    // Wait for all ZIPs to be processed and flatten the array
    const nestedResults = await Promise.all(zipPromises);
    return nestedResults.flat();

  } catch (error) {
    logger.error('subsro', `Provider search failed: ${error.message}`, { imdbId: imdbIdFull });
    return [];
  }
};
