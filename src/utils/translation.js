'use strict';
const logger = require('./logger');

// Default: Google Translate — free, no API key, no signup, no server needed
// Fallbacks: LibreTranslate (self-hosted), DeepL (API key required)

// Supported translation backends. Set MT_SERVICE_TYPE env var:
//   "google" (default)  — free, no key, uses translate.googleapis.com
//   "libretranslate"     — self-hosted only, requires API key
//   "deepl"             — best quality, 500k chars/month free tier

/**
 * Translate text using a configured translation backend.
 *
 * Supported backends (via MT_SERVICE_TYPE env var):
 *   - "google" (default): Free, no API key needed
 *       Uses translate.googleapis.com — just works out of the box
 *   - "libretranslate": Self-hosted only (public demo now requires API key)
 *       Needs: MT_SERVICE_URL, MT_SERVICE_KEY
 *       Auth: Authorization: ApiKey <key>
 *   - "deepl": Best translation quality
 *       Needs: MT_SERVICE_URL=https://api-free.deepl.com/v2, MT_SERVICE_KEY
 *       Auth: Authorization: DeepL-Auth-Key <key>
 *
 * @param {string} text - Text to translate
 * @param {string} sourceLang - ISO 639-1 or 639-2 code (e.g., 'en', 'eng')
 * @param {string} targetLang - ISO 639-1 or 639-2 code (e.g., 'ro', 'ron')
 * @returns {Promise<string|null>} Translated text, or null on failure
 */
async function translate(text, sourceLang, targetLang) {
  const serviceType = process.env.MT_SERVICE_TYPE || 'google';
  const mtUrl = process.env.MT_SERVICE_URL || 'https://libretranslate.de';
  const mtApiKey = process.env.MT_SERVICE_KEY || '';

  if (!text || !sourceLang || !targetLang || sourceLang === targetLang) return text;

  // Normalize language codes to ISO 639-1 for translation APIs
  const langMap = {
    eng: 'en', ron: 'ro', fre: 'fr', spa: 'es', ger: 'de',
    ita: 'it', por: 'pt', gre: 'el', hun: 'hu', ara: 'ar',
    jpn: 'ja', kor: 'ko', chi: 'zh', tur: 'tr', dut: 'nl',
    swe: 'sv', hin: 'hi', tha: 'th', cze: 'cs', pol: 'pl',
    hrv: 'hr', srp: 'sr', slv: 'sl', ukr: 'uk', rus: 'ru',
    ind: 'id', vie: 'vi', bul: 'bg', fin: 'fi', dan: 'da',
    nor: 'no', heb: 'he',
  };
  const src = langMap[sourceLang] || sourceLang;
  const tgt = langMap[targetLang] || targetLang;

  try {
    const { http } = require('./http');

    if (serviceType === 'google') {
      // Google Translate free JSON endpoint — no API key required
      // Uses the same endpoint that translate.google.com uses internally
      const response = await http.get('https://translate.googleapis.com/translate_a/single', {
        params: {
          client: 'gtx',
          sl: src,
          tl: tgt,
          dt: 't',
          q: text,
        },
        timeout: 10000,
      });
      // Response format: [[['translated', 'original', ...], ...], ...]
      // response.data[0] = array of translation segments, each: [translatedText, originalText, ...]
      // Later elements contain metadata (language codes, confidence, model info) — must NOT be included
      if (response?.data && Array.isArray(response.data[0])) {
        const translated = response.data[0]
          .filter(item => Array.isArray(item) && typeof item[0] === 'string')
          .map(item => item[0])
          .join('');
        return translated || null;
      }
      return null;

    } else if (serviceType === 'deepl') {
      // DeepL API — requires API key
      // Free tier: 500,000 chars/month
      if (!mtApiKey) {
        logger.warn('translation', 'DeepL requires MT_SERVICE_KEY');
        return null;
      }
      const response = await http.post(`${mtUrl}/translate`, {
        text: [text],
        source_lang: src.toUpperCase(),
        target_lang: tgt.toUpperCase(),
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `DeepL-Auth-Key ${mtApiKey}`,
        },
        timeout: 10000,
      });
      return response?.data?.translations?.[0]?.text || null;

    } else {
      // LibreTranslate — self-hosted only
      // Public demo (libretranslate.de) now requires an API key for all requests
      if (!mtApiKey) {
        logger.warn('translation', 'LibreTranslate requires MT_SERVICE_KEY (public demo no longer works without one)');
        return null;
      }
      const headers = { 'Content-Type': 'application/json' };
      // LibreTranslate uses its own ApiKey scheme (NOT Bearer)
      headers['Authorization'] = `ApiKey ${mtApiKey}`;

      const response = await http.post(`${mtUrl}/translate`, {
        q: text,
        source: src,
        target: tgt,
        format: 'text',
      }, {
        headers,
        timeout: 10000,
      });

      return response?.data?.translatedText || null;
    }
  } catch (error) {
    logger.warn('translation', `MT failed [${serviceType}]: ${error.message}`);
    return null;
  }
}

/**
 * Translate subtitle cues in batch using numbered XML tags as delimiters.
 *
 * Google Translate preserves XML tags, so we wrap each cue in <1>...</1>, <2>...</2> etc.
 * This prevents the separator mangling that caused phantom/duplicate subtitle lines
 * with the old \n||| approach, while keeping batch speed (unlike per-cue translation).
 *
 * @param {string[]} lines - Array of subtitle text items (may contain newlines)
 * @param {string} sourceLang
 * @param {string} targetLang
 * @returns {Promise<string[]>} Translated lines (unchanged if translation fails)
 */
async function translateBatch(lines, sourceLang, targetLang) {
  if (!lines || lines.length === 0) return lines;

  const CHUNK_SIZE = 15;
  const results = [];

  for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
    const chunk = lines.slice(i, i + CHUNK_SIZE);

    // Wrap each cue in numbered XML tags — Google Translate preserves these intact
    const tagged = chunk.map((line, idx) => `<${idx + 1}>${line}</${idx + 1}>`).join('\n');

    const translated = await translate(tagged, sourceLang, targetLang);
    if (translated) {
      // Extract text between matching open/close tags
      const extracted = [];
      let allMatched = true;

      for (let j = 0; j < chunk.length; j++) {
        const openTag = `<${j + 1}>`;
        const closeTag = `</${j + 1}>`;
        const startIdx = translated.indexOf(openTag);
        const endIdx = translated.indexOf(closeTag);

        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          extracted.push(translated.substring(startIdx + openTag.length, endIdx));
        } else {
          allMatched = false;
          break;
        }
      }

      if (allMatched && extracted.length === chunk.length) {
        results.push(...extracted);
        continue;
      }

      // Tags were mangled — keep originals for this chunk
      logger.warn('translation', `Tag extraction failed for chunk at offset ${i}. Keeping originals.`);
    }

    // Fallback: keep original lines
    results.push(...chunk);
  }

  return results;
}

module.exports = { translate, translateBatch };
