const LRU = require('lru-cache');
const logger = require('../utils/logger');
const { srtToVtt, decodeSrt } = require('../utils/converter');
const { extractSrt } = require('../utils/zip');
const { http } = require('../utils/http');

// Ephemeral L2 Cache
const cache = new LRU({
  max: 2000, 
  ttl: 1000 * 60 * 60 * 24 
});

module.exports = async (req, res) => {
  const { provider, subtitleId, ext } = req.params;
  const isSrt = ext === 'srt';
  const configBase64 = req.query.config;

  try {
    const cacheKey = `${ext}:${provider}:${subtitleId}`;
    if (cache.has(cacheKey)) {
      res.setHeader('Content-Type', isSrt ? 'text/plain; charset=utf-8' : 'text/vtt; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.send(cache.get(cacheKey));
    }

    if (!configBase64) throw new Error("Missing config parameter");
    const config = JSON.parse(Buffer.from(configBase64, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(subtitleId, 'base64url').toString('utf8'));

    let subBuffer;

    switch (provider) {
      case 'opensubtitles': {
        const apiKey = config.opensubtitles_api_key || process.env.OPENSUBTITLES_API_KEY;
        if (!apiKey) throw new Error("Missing OpenSubtitles API Key");
        
        const dlRes = await http.post('https://api.opensubtitles.com/api/v1/download', 
          { file_id: payload.id },
          { headers: { 'Api-Key': apiKey, 'User-Agent': 'SubtitleHub v1.0.0', 'Accept': 'application/json' } }
        );
        
        if (!dlRes?.data?.link) throw new Error("OpenSubtitles API denied the download link.");
        
        const fileRes = await http.get(dlRes.data.link, { responseType: 'arraybuffer' });
        subBuffer = Buffer.from(fileRes.data);
        break;
      }
      case 'subdl': {
        const dlUrl = payload.url.startsWith('http') 
            ? payload.url 
            : `https://dl.subdl.com${payload.url.startsWith('/') ? '' : '/'}${payload.url}`;
            
        const fileRes = await http.get(dlUrl, { responseType: 'arraybuffer' });
        subBuffer = Buffer.from(fileRes.data);
        
        // Safely check for ZIP/RAR magic bytes before extracting
        if ((subBuffer[0] === 0x50 && subBuffer[1] === 0x4B) || subBuffer.toString('utf8', 0, 4) === 'Rar!') {
          subBuffer = await extractSrt(subBuffer, payload.lang);
        }
        break;
      }
      case 'subsource': {
        const apiKey = config.subsource_api_key || process.env.SUBSOURCE_API_KEY;
        const dlRes = await http.post('https://api.subsource.net/api/downloadSub', {
          movie: payload.slug,
          lang: payload.lang,
          id: payload.id
        }, { headers: { ...(apiKey && { 'apiKey': apiKey }) } });
        
        if (!dlRes?.data?.subUrl) throw new Error("SubSource did not return a valid download URL.");
        
        const fileRes = await http.get(dlRes.data.subUrl, { responseType: 'arraybuffer' });
        subBuffer = Buffer.from(fileRes.data);
        
        if ((subBuffer[0] === 0x50 && subBuffer[1] === 0x4B) || subBuffer.toString('utf8', 0, 4) === 'Rar!') {
          subBuffer = await extractSrt(subBuffer, payload.lang);
        }
        break;
      }
      default:
        throw new Error("Unknown provider");
    }

    // Serve either pure Decoded SRT (for local proxy) or VTT (for direct playback)
    const finalContent = isSrt ? decodeSrt(subBuffer) : srtToVtt(subBuffer);

    cache.set(cacheKey, finalContent);

    res.setHeader('Content-Type', isSrt ? 'text/plain; charset=utf-8' : 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(finalContent);

  } catch (error) {
    logger.error('proxy', `Failed to serve subtitle: ${error.message}`, { provider });
    res.status(404).send('Subtitle not found or failed to process.');
  }
};
