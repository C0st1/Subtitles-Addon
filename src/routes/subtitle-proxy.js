const axios = require('axios');
const LRU = require('lru-cache');
const logger = require('../utils/logger');
const { srtToVtt } = require('../utils/converter');
const { extractSrt } = require('../utils/zip');

// Ephemeral L2 Cache for VTT content
const vttCache = new LRU({
  max: 500,
  ttl: 1000 * 60 * 60 // 1 hour
});

module.exports = async (req, res) => {
  const { provider, subtitleId } = req.params;
  const configBase64 = req.query.config;

  try {
    const cacheKey = `vtt:${provider}:${subtitleId}`;
    if (vttCache.has(cacheKey)) {
      logger.info('proxy', 'Cache hit', { provider, subtitleId });
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.send(vttCache.get(cacheKey));
    }

    if (!configBase64) throw new Error("Missing config parameter");
    const config = JSON.parse(Buffer.from(configBase64, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(subtitleId, 'base64url').toString('utf8'));

    let vttContent = '';

    switch (provider) {
      case 'opensubtitles': {
        const apiKey = config.opensubtitles_api_key || process.env.OPENSUBTITLES_API_KEY;
        if (!apiKey) throw new Error("Missing OpenSubtitles API Key");
        
        const dlRes = await axios.post('https://api.opensubtitles.com/api/v1/download', 
          { file_id: payload.id },
          { headers: { 'Api-Key': apiKey, 'User-Agent': 'SubtitleAggregator v1.0.0' } }
        );
        const fileRes = await axios.get(dlRes.data.link, { responseType: 'arraybuffer' });
        vttContent = srtToVtt(fileRes.data);
        break;
      }
      case 'subdl': {
        const fileRes = await axios.get(`https://dl.subdl.com/subtitle/${payload.url}`, { responseType: 'arraybuffer' });
        try {
          const srtBuffer = extractSrt(fileRes.data);
          vttContent = srtToVtt(srtBuffer);
        } catch (e) {
          vttContent = srtToVtt(fileRes.data); // Fallback to raw buffer
        }
        break;
      }
      case 'subsource': {
        const apiKey = config.subsource_api_key || process.env.SUBSOURCE_API_KEY;
        const dlRes = await axios.post('https://api.subsource.net/api/downloadSub', {
          movie: payload.slug,
          lang: payload.lang,
          id: payload.id
        }, { headers: { ...(apiKey && { 'apiKey': apiKey }) } });
        
        const fileRes = await axios.get(dlRes.data.subUrl, { responseType: 'arraybuffer' });
        try {
          const srtBuffer = extractSrt(fileRes.data);
          vttContent = srtToVtt(srtBuffer);
        } catch (e) {
          vttContent = srtToVtt(fileRes.data); // Fallback to raw buffer
        }
        break;
      }
      case 'subsro': {
        const apiKey = config.subsro_api_key || process.env.SUBSRO_API_KEY;
        if (!apiKey) throw new Error("Missing Subs.ro API Key");
        
        const fileRes = await axios.get(`https://api.subs.ro/v1.0/subtitle/${payload.id}/download`, {
          headers: { 'X-Subs-Api-Key': apiKey },
          responseType: 'arraybuffer'
        });
        try {
          const srtBuffer = extractSrt(fileRes.data);
          vttContent = srtToVtt(srtBuffer);
        } catch (e) {
          vttContent = srtToVtt(fileRes.data); // Fallback to raw buffer
        }
        break;
      }
      default:
        throw new Error("Unknown provider");
    }

    vttCache.set(cacheKey, vttContent);

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(vttContent);

  } catch (error) {
    logger.error('proxy', `Failed to serve subtitle: ${error.message}`, { provider });
    res.status(404).send('Subtitle not found or failed to process.');
  }
};
