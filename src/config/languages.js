const langMap = {
  'eng': { opensubtitles: 'en', subdl: 'EN', subsource: 'english' },
  'ron': { opensubtitles: 'ro', subdl: 'RO', subsource: 'romanian' },
  'rum': { opensubtitles: 'ro', subdl: 'RO', subsource: 'romanian' }, // Legacy Map
  'fre': { opensubtitles: 'fr', subdl: 'FR', subsource: 'french' },
  'fra': { opensubtitles: 'fr', subdl: 'FR', subsource: 'french' }, // Legacy Map
  'spa': { opensubtitles: 'es', subdl: 'ES', subsource: 'spanish' },
  'ger': { opensubtitles: 'de', subdl: 'DE', subsource: 'german' },
  'deu': { opensubtitles: 'de', subdl: 'DE', subsource: 'german' }, // Legacy Map
  'ita': { opensubtitles: 'it', subdl: 'IT', subsource: 'italian' },
  'hun': { opensubtitles: 'hu', subdl: 'HU', subsource: 'hungarian' },
  'por': { opensubtitles: 'pt', subdl: 'PT', subsource: 'portuguese' },
  'gre': { opensubtitles: 'el', subdl: 'EL', subsource: 'greek' }
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
