const { http } = require('../utils/http');
const { toProviderCode, fromProviderCode } = require('../config/languages');

const USER_AGENT = 'SubtitleHub v1.0.0';

module.exports = async (params) => {
  const { imdbId, season, episode, type, languages, config } = params;
  const apiKey = config.opensubtitles_api_key || process.env.OPENSUBTITLES_API_KEY;
  if (!apiKey) return [];

  const osLangs = languages
    .map(l => toProviderCode(l, 'opensubtitles'))
    .filter(Boolean)
    .join(',');
  if (!osLangs) return [];

  const query = new URLSearchParams({
    imdb_id: imdbId,
    languages: osLangs,
    type: type === 'series' ? 'episode' : 'movie',
  });

  if (type === 'series' && season != null && episode != null) {
    query.append('season_number', season);
    query.append('episode_number', episode);
  }

  const res = await http.get(
    `https://api.opensubtitles.com/api/v1/subtitles?${query.toString()}`,
    { headers: { 'Api-Key': apiKey, 'User-Agent': USER_AGENT } }
  );

  const results = [];

  for (const item of res?.data?.data || []) {
    for (const file of item?.attributes?.files || []) {
      const payload = Buffer.from(JSON.stringify({ id: file.file_id })).toString('base64url');
      // Convert provider 2-letter code back to ISO 639-2 (3-letter) for Stremio
      const isoLang =
        fromProviderCode(item.attributes.language, 'opensubtitles') ||
        item.attributes.language;

      results.push({
        id: payload,
        lang: isoLang,
        provider: 'opensubtitles',
        releaseName: item.attributes.release,
      });
    }
  }

  return results;
};
