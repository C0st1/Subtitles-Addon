const { parseId } = require('../utils/imdb');
const logger = require('../utils/logger');
const openSubtitles = require('../providers/opensubtitles');
const subdl = require('../providers/subdl');
const subsource = require('../providers/subsource');
const subsro = require('../providers/subsro');

const PROVIDERS = {
  opensubtitles: openSubtitles,
  subdl: subdl,
  subsource: subsource,
  subsro: subsro
};

/**
 * Wraps a promise with a timeout.
 */
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
    const enabledSources = (config.enabled_sources || 'opensubtitles,subdl,subsource,subsro')
      .split(',').map(s => s.trim().toLowerCase());

    const fetchParams = {
      ...parsedId,
      type,
      languages,
      config
    };

    // Execute enabled providers in parallel with an 8-second timeout
    const promises = enabledSources
      .filter(source => PROVIDERS[source])
      .map(source => {
        return withTimeout(PROVIDERS[source](fetchParams), 8000)
          .catch(err => {
            logger.error(source, `Provider failed: ${err.message}`, { imdbId: parsedId.imdbId });
            return []; // Fail gracefully
          });
      });

    const results = await Promise.allSettled(promises);
    
    const subtitles = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);

    // Construct proxy URLs
    const configBase64 = Buffer.from(JSON.stringify(config)).toString('base64url');
    
    const formattedSubtitles = subtitles.map(sub => {
      const host = config.addon_host || 'localhost:7000';
      const protocol = host.includes('localhost') ? 'http' : 'https';
      const baseUrl = `${protocol}://${host}`;
      
      let proxyUrl = `${baseUrl}/subtitle/${sub.provider}/${sub.id}.vtt?config=${configBase64}`;

      if (config.force_encoding_detection) {
        proxyUrl = `http://127.0.0.1:11470/subtitles.vtt?from=${encodeURIComponent(proxyUrl)}`;
      }

      return {
        // FIX: We add a hash of the release name to the ID to ensure 
        // Stremio doesn't merge the 1080p and 4K versions into one entry.
        id: `${sub.provider}-${sub.id}-${sub.lang}-${Buffer.from(sub.releaseName).toString('hex').slice(0, 8)}`,
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
