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
    const enabledSources = (config.enabled_sources || 'opensubtitles,subdl,subsource')
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
        return withTimeout(PROVIDERS[source](fetchParams), 5000)
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
  
  // Use the provider's specific payload (which already contains the id and fileName)
  // This ensures the proxy knows exactly which file to pick
  let proxyUrl = `${baseUrl}/subtitle/${sub.provider}/${sub.id}.vtt?config=${configBase64}`;

  if (config.force_encoding_detection) {
    proxyUrl = `http://127.0.0.1:11470/subtitles.vtt?from=${encodeURIComponent(proxyUrl)}`;
  }

  return {
    // Use the full sub.id (the base64url-encoded payload) as the Stremio ID.
    // sub.id already uniquely encodes every piece of routing data — archive ID,
    // file name, download slug, etc. — so no further hashing or slicing is needed.
    //
    // The previous approach of slicing sub.id to 16 chars and appending only the
    // first 4 bytes of the release name as hex caused two independent collision
    // paths:
    //   1. Same-archive variants (e.g. 1080p vs 4K) share an identical JSON
    //      prefix in their payloads, so their base64url strings are identical
    //      through at least the first 16 characters.
    //   2. Any two releases with the same title prefix (e.g. "Movie.2024.")
    //      produce the same 8-char hex fragment, collapsing into one Stremio
    //      entry even when the archive IDs differ.
    // Stremio deduplicates by this id field, so both paths cause separate
    // subtitle variants to be silently merged into a single selectable entry.
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
