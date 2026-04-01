'use strict';

/**
 * Language code mapping between ISO 639-2 (Stremio) and provider-specific codes.
 * Supports legacy bibliographic codes (e.g., 'rum' for Romanian) alongside terminological codes.
 */
const langMap = {
  // English
  'eng': { opensubtitles: 'en', subdl: 'EN', subsource: 'english' },
  // Romanian (both terminological and bibliographic codes)
  'ron': { opensubtitles: 'ro', subdl: 'RO', subsource: 'romanian' },
  'rum': { opensubtitles: 'ro', subdl: 'RO', subsource: 'romanian' },
  // French
  'fre': { opensubtitles: 'fr', subdl: 'FR', subsource: 'french' },
  'fra': { opensubtitles: 'fr', subdl: 'FR', subsource: 'french' },
  // Spanish
  'spa': { opensubtitles: 'es', subdl: 'ES', subsource: 'spanish' },
  // German
  'ger': { opensubtitles: 'de', subdl: 'DE', subsource: 'german' },
  'deu': { opensubtitles: 'de', subdl: 'DE', subsource: 'german' },
  // Italian
  'ita': { opensubtitles: 'it', subdl: 'IT', subsource: 'italian' },
  // Portuguese
  'por': { opensubtitles: 'pt', subdl: 'PT', subsource: 'portuguese' },
  // Greek
  'gre': { opensubtitles: 'el', subdl: 'EL', subsource: 'greek' },
  'ell': { opensubtitles: 'el', subdl: 'EL', subsource: 'greek' },
  // Hungarian
  'hun': { opensubtitles: 'hu', subdl: 'HU', subsource: 'hungarian' },
  // Arabic
  'ara': { opensubtitles: 'ar', subdl: 'AR', subsource: 'arabic' },
  // Japanese
  'jpn': { opensubtitles: 'ja', subdl: 'JA', subsource: 'japanese' },
  // Korean
  'kor': { opensubtitles: 'ko', subdl: 'KO', subsource: 'korean' },
  // Chinese (Simplified)
  'chi': { opensubtitles: 'zh-cn', subdl: 'ZH', subsource: 'chinese' },
  'zho': { opensubtitles: 'zh-cn', subdl: 'ZH', subsource: 'chinese' },
  // Turkish
  'tur': { opensubtitles: 'tr', subdl: 'TR', subsource: 'turkish' },
  // Dutch
  'dut': { opensubtitles: 'nl', subdl: 'NL', subsource: 'dutch' },
  'nld': { opensubtitles: 'nl', subdl: 'NL', subsource: 'dutch' },
  // Swedish
  'swe': { opensubtitles: 'sv', subdl: 'SV', subsource: 'swedish' },
  // Hindi
  'hin': { opensubtitles: 'hi', subdl: 'HI', subsource: 'hindi' },
  // Thai
  'tha': { opensubtitles: 'th', subdl: 'TH', subsource: 'thai' },
  // Czech
  'cze': { opensubtitles: 'cs', subdl: 'CS', subsource: 'czech' },
  'ces': { opensubtitles: 'cs', subdl: 'CS', subsource: 'czech' },
  // Polish
  'pol': { opensubtitles: 'pl', subdl: 'PL', subsource: 'polish' },
  // Croatian
  'hrv': { opensubtitles: 'hr', subdl: 'HR', subsource: 'croatian' },
  // Serbian
  'srp': { opensubtitles: 'sr', subdl: 'SR', subsource: 'serbian' },
  // Slovenian
  'slv': { opensubtitles: 'sl', subdl: 'SL', subsource: 'slovenian' },
  // Ukrainian
  'ukr': { opensubtitles: 'uk', subdl: 'UK', subsource: 'ukrainian' },
  // Russian
  'rus': { opensubtitles: 'ru', subdl: 'RU', subsource: 'russian' },
  // Indonesian
  'ind': { opensubtitles: 'id', subdl: 'ID', subsource: 'indonesian' },
  // Vietnamese
  'vie': { opensubtitles: 'vi', subdl: 'VI', subsource: 'vietnamese' },
  // Bulgarian
  'bul': { opensubtitles: 'bg', subdl: 'BG', subsource: 'bulgarian' },
  // Finnish
  'fin': { opensubtitles: 'fi', subdl: 'FI', subsource: 'finnish' },
  // Danish
  'dan': { opensubtitles: 'da', subdl: 'DA', subsource: 'danish' },
  // Norwegian
  'nor': { opensubtitles: 'no', subdl: 'NO', subsource: 'norwegian' },
  // Hebrew
  'heb': { opensubtitles: 'he', subdl: 'HE', subsource: 'hebrew' },
};

// Reverse lookup cache: "providerName:lowercaseCode" → iso6392
const reverseCache = new Map();

/**
 * Build the reverse lookup cache on first use.
 */
function ensureReverseCache() {
  if (reverseCache.size > 0) return;
  for (const [iso, providers] of Object.entries(langMap)) {
    for (const [providerName, code] of Object.entries(providers)) {
      reverseCache.set(`${providerName}:${code.toLowerCase()}`, iso);
    }
  }
}

/**
 * Convert a Stremio ISO 639-2 code to a provider-specific language code.
 * @param {string} iso6392Code
 * @param {string} providerName - 'opensubtitles', 'subdl', or 'subsource'
 * @returns {string|null} Provider code, or null if not supported
 */
function toProviderCode(iso6392Code, providerName) {
  const mapping = langMap[iso6392Code];
  return mapping ? mapping[providerName] : null;
}

/**
 * Convert a provider-specific language code back to a Stremio ISO 639-2 code.
 * FIX: Uses pre-built reverse cache for O(1) lookup with normalized keys.
 * @param {string} providerCode - Provider-specific language code
 * @param {string} providerName - 'opensubtitles', 'subdl', or 'subsource'
 * @returns {string|null} ISO 639-2 code, or null if not found
 */
function fromProviderCode(providerCode, providerName) {
  if (!providerCode) return null;
  ensureReverseCache();
  return reverseCache.get(`${providerName}:${providerCode.toLowerCase()}`) || null;
}

/**
 * Get the list of all supported ISO 639-2 language codes.
 * @returns {string[]}
 */
function getSupportedLanguages() {
  // Deduplicate (some codes like ron/rum map to the same language)
  const seen = new Set();
  return Object.keys(langMap).filter(code => {
    const base = code.substring(0, 3);
    if (seen.has(base)) return false;
    seen.add(base);
    return true;
  });
}

/**
 * Get language display names for the configure UI.
 * @returns {Object} Map of ISO 639-2 code to display name
 */
function getLanguageDisplayNames() {
  const displayNames = {
    'eng': 'English', 'ron': 'Romanian', 'fre': 'French', 'spa': 'Spanish',
    'ger': 'German', 'ita': 'Italian', 'por': 'Portuguese', 'gre': 'Greek',
    'hun': 'Hungarian', 'ara': 'Arabic', 'jpn': 'Japanese', 'kor': 'Korean',
    'chi': 'Chinese', 'tur': 'Turkish', 'dut': 'Dutch', 'swe': 'Swedish',
    'hin': 'Hindi', 'tha': 'Thai', 'cze': 'Czech', 'pol': 'Polish',
    'hrv': 'Croatian', 'rus': 'Russian', 'ukr': 'Ukrainian', 'bul': 'Bulgarian',
    'fin': 'Finnish', 'dan': 'Danish', 'nor': 'Norwegian', 'heb': 'Hebrew',
    'ind': 'Indonesian', 'vie': 'Vietnamese', 'srp': 'Serbian', 'slv': 'Slovenian',
  };
  return displayNames;
}

module.exports = { toProviderCode, fromProviderCode, getSupportedLanguages, getLanguageDisplayNames };
