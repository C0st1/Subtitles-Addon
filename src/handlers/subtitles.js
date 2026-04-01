const { parseId } = require('../utils/imdb');
const logger = require('../utils/logger');
const { resolveAddonHost } = require('../utils/validate');
const openSubtitles = require('../providers/opensubtitles');
const subdl = require('../providers/subdl');
const subsource = require('../providers/subsource');

const PROVIDERS = {
  opensubtitles: openSubtitles,
  subdl,
  subsource,
};

const DEFAULT_TIMEOUT_MS = 5000;

const withTimeout = (promise, ms = DEFAULT_TIMEOUT_MS) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

module.exports = async (args) => {
  try {
    const { type, id, config, requestHeaders } = args;
    if (!config) throw new Error('Configuration missing');

    const parsedId = parseId(id);
    const languages = (config.languages || 'eng')
      .split(',')
      .map(l => l.trim().toLowerCase())
      .filter(Boolean);

    const enabledSources = (config.enabled_sources || 'opensubtitles,subdl,subsource')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(s => PROVIDERS[s]);

    const fetchParams = {
      ...parsedId,
      type,
      languages,
      config,
      title: args.extra?.show_name || args.extra?.filename,
    };

    const promises = enabledSources.map(source =>
      withTimeout(PROVIDERS[source](fetchParams), DEFAULT_TIMEOUT_MS).catch(err => {
        logger.error(source, `Provider failed: ${err.message}`, {
          imdbId: parsedId.imdbId,
        });
        return [];
      })
    );

    const results = await Promise.all(promises);
    const subtitles = results.flat();

    const configBase64 = Buffer.from(JSON.stringify(config)).toString('base64url');

    // FIX: Resolve addon_host from env var (trusted) rather than blindly using
    // a user-supplied Host header which could be set by an attacker to leak
    // API keys (SSRF via open redirect in subtitle proxy URLs).
    const host = resolveAddonHost(requestHeaders?.host || config.addon_host);
    const protocol = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
    const baseUrl = `${protocol}://${host}`;

    const formattedSubtitles = subtitles.map(sub => ({
      id: `${sub.provider}-${sub.id}`,
      url: `${baseUrl}/subtitle/${sub.provider}/${sub.id}.vtt?config=${configBase64}`,
      lang: sub.lang,
    }));

    return { subtitles: formattedSubtitles };
  } catch (error) {
    logger.error('system', `Handler error: ${error.message}`);
    return { subtitles: [] };
  }
};
