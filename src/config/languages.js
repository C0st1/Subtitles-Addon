const langMap = {
  'eng': { opensubtitles: 'en', subdl: 'EN', subsource: 'english', subsro: 'en' },
  'ron': { opensubtitles: 'ro', subdl: 'RO', subsource: 'romanian', subsro: 'ro' },
  'fre': { opensubtitles: 'fr', subdl: 'FR', subsource: 'french', subsro: 'fra' },
  'spa': { opensubtitles: 'es', subdl: 'ES', subsource: 'spanish', subsro: 'spa' },
  'ger': { opensubtitles: 'de', subdl: 'DE', subsource: 'german', subsro: 'ger' },
  'ita': { opensubtitles: 'it', subdl: 'IT', subsource: 'italian', subsro: 'ita' },
  'hun': { opensubtitles: 'hu', subdl: 'HU', subsource: 'hungarian', subsro: 'ung' },
  'por': { opensubtitles: 'pt', subdl: 'PT', subsource: 'portuguese', subsro: 'por' },
  'gre': { opensubtitles: 'el', subdl: 'EL', subsource: 'greek', subsro: 'gre' }
  // Add more mappings as needed based on the prompt's table
};

function toProviderCode(iso6392Code, providerName) {
  const mapping = langMap[iso6392Code];
  return mapping ? mapping[providerName] : null;
}

function fromProviderCode(providerCode, providerName) {
  for (const [iso, providers] of Object.entries(langMap)) {
    if (providers[providerName] && providers[providerName].toLowerCase() === providerCode.toLowerCase()) {
      return iso;
    }
  }
  return null;
}

module.exports = { toProviderCode, fromProviderCode };
