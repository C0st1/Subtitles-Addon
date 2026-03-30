// src/config/languages.js

const langMap = {
  'eng': { opensubtitles: 'en', subdl: 'EN', subsource: 'english' },
  'ron': { opensubtitles: 'ro', subdl: 'RO', subsource: 'romanian' ,
  'fre': { opensubtitles: 'fr', subdl: 'FR', subsource: 'french' },
  'spa': { opensubtitles: 'es', subdl: 'ES', subsource: 'spanish' },
  'ger': { opensubtitles: 'de', subdl: 'DE', subsource: 'german' },
  'ita': { opensubtitles: 'it', subdl: 'IT', subsource: 'italian' },
  'hun': { opensubtitles: 'hu', subdl: 'HU', subsource: 'hungarian' },
  'por': { opensubtitles: 'pt', subdl: 'PT', subsource: 'portuguese' },
  'gre': { opensubtitles: 'el', subdl: 'EL', subsource: 'greek' }
};

/**
 * Converts a Stremio ISO 639-2 code to a provider-specific language code.
 * @param {string} iso6392Code - e.g., "eng", "ron"
 * @param {string} providerName - e.g., "subsro", "opensubtitles"
 * @returns {string|null}
 */
function toProviderCode(iso6392Code, providerName) {
  const mapping = langMap[iso6392Code];
  return mapping ? mapping[providerName] : null;
}

/**
 * Converts a provider-specific language code back to a Stremio ISO 639-2 code.
 * @param {string} providerCode - e.g., "ro", "fra"
 * @param {string} providerName - e.g., "subsro"
 * @returns {string|null}
 */
function fromProviderCode(providerCode, providerName) {
  for (const [iso, providers] of Object.entries(langMap)) {
    if (providers[providerName] && providers[providerName].toLowerCase() === providerCode.toLowerCase()) {
      return iso;
    }
  }
  return null;
}

module.exports = { toProviderCode, fromProviderCode };
