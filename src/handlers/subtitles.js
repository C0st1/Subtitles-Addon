const { parseId } = require('../utils/imdb');
const logger = require('../utils/logger');
const openSubtitles = require('../providers/opensubtitles');
const subdl = require('../providers/subdl');
const subsource = require('../providers/subsource');

const PROVIDERS = {
  opensubtitles: openSubtitles,
  subdl: subdl,
  subsource: subsource,
};

const withTimeout = (promise, ms) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

module.exports = async (args) => {
  try {
    const { type, id, config } = args;
    if (!config) throw new Error("Configuration missing");

    const parsedId = parseId(id);
    const languages = (config.languages || 'eng').split(',').map(l => l.trim().toLowerCase());
    const enabledSources = (config.enabled_sources || 'opensubtitles,subdl,subsource')
      .split(',').map(s => s.trim().toLowerCase());

    const fetchParams = {
      ...parsedId,
      type,
      languages,
      config,
      title: args.extra?.show_name || args.extra?.filename
    };

    const promises = enabledSources
      .filter(source => PROVIDERS[source])
      .map(source => {
        return withTimeout(PROVIDERS[source](fetchParams), 5000)
          .catch(err => {
            logger.error(source, `Provider failed: ${err.message}`, { imdbId: parsedId.imdbId });
            return []; // Fail gracefully
          });
      });

    // We can safely use Promise.all because internal catch blocks prevent rejections
    const results = await Promise.all(promises);
    const subtitles = results.flatMap(r => r);

    const configBase64 = Buffer.from(JSON.stringify(config)).toString('base64url');
    
    const formattedSubtitles = subtitles.map(sub => {
      const host = config.addon_host || 'localhost:7000';
      const protocol = host.includes('localhost') ? 'http' : 'https';
      const baseUrl = `${protocol}://${host}`;
      
      let proxyUrl = `${baseUrl}/subtitle/${sub.provider}/${sub.id}.vtt?config=${configBase64}`;

      if (config.force_encoding_detection) {
        // Feed the raw SRT string into Stremio's internal encoding proxy instead of VTT
        const srtProxyUrl = `${baseUrl}/subtitle/${sub.provider}/${sub.id}.srt?config=${configBase64}`;
        proxyUrl = `http://127.0.0.1:11470/subtitles.vtt?from=${encodeURIComponent(srtProxyUrl)}`;
      }

      return {
        id: `${sub.provider}-${sub.id}`,
        url: proxyUrl,
        lang: sub.lang
      };
    });

    return { subtitles: formattedSubtitles };
  } catch (error) {
    logger.error('system', `Handler error: ${error.message}`);
    return { subtitles: [] };
  }
};
