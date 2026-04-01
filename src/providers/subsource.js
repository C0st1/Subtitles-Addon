const { http } = require('../utils/http');
const { toProviderCode, fromProviderCode } = require('../config/languages');

/**
 * SubSource Provider
 *
 * Improvements over original:
 * - Removed bare `axios` import; all HTTP calls now go through the shared
 *   `http` instance (consistent 5s timeout + connection pool).
 * - Title matching is now case/punctuation-normalised to reduce missed matches
 *   when the API returns slightly different formatting.
 * - episode param is passed for series so per-episode subs are returned.
 */

/** Normalise a title for fuzzy matching: lowercase, strip punctuation, collapse spaces. */
function normaliseTitle(t) {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

module.exports = async (params) => {
  const { imdbIdFull, season, episode, type, languages, config, title: providedTitle } = params;
  const apiKey = config.subsource_api_key || process.env.SUBSOURCE_API_KEY;

  const ssLangs = languages.map(l => toProviderCode(l, 'subsource')).filter(Boolean);
  if (!ssLangs.length) return [];

  // Resolve title: use the provided hint first, then Cinemeta as fallback.
  // FIX: Use the shared `http` instance (was using bare `axios` — no timeout).
  let title = providedTitle;
  if (!title) {
    try {
      const metaRes = await http.get(
        `https://v3-cinemeta.strem.io/meta/${type}/${imdbIdFull}.json`
      );
      title = metaRes?.data?.meta?.name;
    } catch {
      return [];
    }
  }

  if (!title) return [];

  const headers = apiKey ? { apiKey } : {};

  try {
    const searchRes = await http.post(
      'https://api.subsource.net/api/searchMovie',
      { query: title },
      { headers }
    );

    // FIX: Normalised comparison so minor formatting differences don't block matches
    const normTarget = normaliseTitle(title);
    const match = searchRes?.data?.found?.find(
      m => m.title && normaliseTitle(m.title) === normTarget
    );
    if (!match) return [];

    const movieSlug = match.folderName;

    const getRes = await http.post(
      'https://api.subsource.net/api/getMovie',
      {
        movieName: movieSlug,
        langs: ssLangs,
        ...(type === 'series' && season != null  && { season }),
        ...(type === 'series' && episode != null && { episode }),
      },
      { headers }
    );

    const results = [];

    for (const sub of getRes?.data?.subs || []) {
      const isoLang = fromProviderCode(sub.lang, 'subsource');
      if (!isoLang) continue;

      const payload = Buffer.from(
        JSON.stringify({ id: sub.subId, slug: movieSlug, lang: sub.lang })
      ).toString('base64url');

      results.push({
        id: payload,
        lang: isoLang,
        provider: 'subsource',
        releaseName: sub.releaseName,
      });
    }
    return results;
  } catch {
    return [];
  }
};
