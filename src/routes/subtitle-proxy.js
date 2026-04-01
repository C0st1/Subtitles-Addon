const LRU = require('lru-cache');
const logger = require('../utils/logger');
const { srtToVtt, decodeSrt } = require('../utils/converter');
const { extractSrt } = require('../utils/zip');
const { http } = require('../utils/http');
const { assertAllowedUrl } = require('../utils/validate');

const USER_AGENT = 'SubtitleHub v1.0.0';

// In-memory L2 cache: keeps the processed subtitle content so repeat requests
// (e.g. seeking in a player) don't hit upstream APIs again.
// FIX: Cache key now includes a hash of the API key so different users' quotas
// are attributed correctly and cached content is not cross-contaminated.
const cache = new LRU({
  max: 2000,
  ttl: 1000 * 60 * 60 * 24, // 24 hours
});

/** Derive a short, non-reversible key segment from an API key string. */
function hashKey(s = '') {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  }
  return (h >>> 0).toString(16);
}

module.exports = async (req, res) => {
  const { provider, subtitleId, ext } = req.params;
  const isSrt = ext === 'srt';
  const configBase64 = req.query.config;

  try {
    if (!configBase64) throw new Error('Missing config parameter');

    const config = JSON.parse(Buffer.from(configBase64, 'base64url').toString('utf8'));
    if (typeof config !== 'object' || config === null) throw new Error('Invalid config');

    const payload = JSON.parse(Buffer.from(subtitleId, 'base64url').toString('utf8'));
    if (typeof payload !== 'object' || payload === null) throw new Error('Invalid subtitle ID');

    // FIX: Build cache key that includes the provider-specific API key so that
    // User A's cached download doesn't silently consume User B's quota.
    const apiKeyForCache =
      config.opensubtitles_api_key ||
      config.subdl_api_key ||
      config.subsource_api_key ||
      '';
    const cacheKey = `${ext}:${provider}:${subtitleId}:${hashKey(apiKeyForCache)}`;

    if (cache.has(cacheKey)) {
      res.setHeader('Content-Type', isSrt ? 'text/plain; charset=utf-8' : 'text/vtt; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('X-Cache', 'HIT');
      return res.send(cache.get(cacheKey));
    }

    let subBuffer;

    switch (provider) {
      case 'opensubtitles': {
        const apiKey = config.opensubtitles_api_key || process.env.OPENSUBTITLES_API_KEY;
        if (!apiKey) throw new Error('Missing OpenSubtitles API key');

        const dlRes = await http.post(
          'https://api.opensubtitles.com/api/v1/download',
          { file_id: parseInt(payload.id, 10) },
          { headers: { 'Api-Key': apiKey, 'User-Agent': USER_AGENT, Accept: 'application/json' } }
        );

        if (!dlRes?.data?.link) throw new Error('OpenSubtitles API denied the download link');
        
        // FIX: Validate the download URL is from a trusted domain (SSRF prevention)
        assertAllowedUrl(dlRes.data.link, 'OpenSubtitles download link');

        const fileRes = await http.get(dlRes.data.link, { responseType: 'arraybuffer' });
        subBuffer = Buffer.from(fileRes.data);
        break;
      }

      case 'subdl': {
        // FIX: Validate payload.url before fetching (SSRF prevention).
        // Previously an attacker could craft a subtitle ID with url pointing to
        // internal services (e.g. http://169.254.169.254/latest/meta-data/).
        const rawUrl = payload.url;
        if (!rawUrl) throw new Error('SubDL payload missing url');

        const dlUrl = rawUrl.startsWith('http')
          ? rawUrl
          : `https://dl.subdl.com${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;

        assertAllowedUrl(dlUrl, 'SubDL download URL');

        const fileRes = await http.get(encodeURI(dlUrl), { responseType: 'arraybuffer' });
        subBuffer = Buffer.from(fileRes.data);

        // Unpack ZIP or RAR archives
        if (isZip(subBuffer) || isRar(subBuffer)) {
          subBuffer = await extractSrt(subBuffer, payload.lang);
        }
        break;
      }

      case 'subsource': {
        const apiKey = config.subsource_api_key || process.env.SUBSOURCE_API_KEY;

        const dlRes = await http.post(
          'https://api.subsource.net/api/downloadSub',
          { movie: payload.slug, lang: payload.lang, id: payload.id },
          { headers: { ...(apiKey && { apiKey }) } }
        );

        if (!dlRes?.data?.subUrl) throw new Error('SubSource did not return a valid download URL');

        // FIX: Validate the download URL (SSRF prevention)
        assertAllowedUrl(dlRes.data.subUrl, 'SubSource download URL');

        const fileRes = await http.get(dlRes.data.subUrl, { responseType: 'arraybuffer' });
        subBuffer = Buffer.from(fileRes.data);

        if (isZip(subBuffer) || isRar(subBuffer)) {
          subBuffer = await extractSrt(subBuffer, payload.lang);
        }
        break;
      }

      default:
        throw new Error(`Unknown provider: ${provider}`);
    }

    const finalContent = isSrt
      ? decodeSrt(subBuffer, payload.lang)
      : srtToVtt(subBuffer, payload.lang);

    cache.set(cacheKey, finalContent);

    res.setHeader('Content-Type', isSrt ? 'text/plain; charset=utf-8' : 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Cache', 'MISS');
    res.send(finalContent);

  } catch (error) {
    logger.error('proxy', `Failed to serve subtitle: ${error.message}`, { provider });
    res.status(404).send('Subtitle not found or failed to process.');
  }
};

// --- helpers ---

function isZip(buf) {
  return buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4B;
}

function isRar(buf) {
  // RAR4: 52 61 72 21 1A 07 00  ("Rar!\x1a\x07\x00")
  // RAR5: 52 61 72 21 1A 07 01  ("Rar!\x1a\x07\x01")
  return (
    buf.length >= 7 &&
    buf[0] === 0x52 && buf[1] === 0x61 && buf[2] === 0x72 && buf[3] === 0x21 &&
    buf[4] === 0x1A && buf[5] === 0x07 && (buf[6] === 0x00 || buf[6] === 0x01)
  );
}
