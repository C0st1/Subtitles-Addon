const chardet = require('chardet');
const iconv = require('iconv-lite');

// Eastern European languages that are commonly mis-detected as windows-1252
// but actually require windows-1250 for correct diacritic rendering.
const EASTERN_EURO_LANGS = new Set(['ron', 'rum', 'hun', 'cze', 'pol', 'slv', 'hrv']);

/**
 * Decodes a raw subtitle buffer to a clean UTF-8 string.
 * Applies a language-aware encoding override for Eastern European files that
 * chardet commonly mis-identifies as ISO-8859-1 / windows-1252.
 *
 * @param {Buffer} buffer
 * @param {string} [lang] - ISO 639-2 language code hint
 * @returns {string}
 */
function decodeSrt(buffer, lang = '') {
  let encoding = chardet.detect(buffer) || 'utf8';

  if (
    EASTERN_EURO_LANGS.has(lang.toLowerCase()) &&
    ['ISO-8859-1', 'windows-1252'].includes(encoding)
  ) {
    encoding = 'windows-1250';
  }

  const safeEncoding = iconv.encodingExists(encoding) ? encoding : 'utf8';
  const text = iconv.decode(buffer, safeEncoding);
  return text.replace(/^\uFEFF/, ''); // Strip BOM
}

/**
 * Strips ASS/SSA styling tags and returns clean SRT-formatted text.
 * Handles the most common override codes: bold, italic, colour, position, etc.
 *
 * @param {string} text - raw ASS/SSA file content
 * @returns {string} SRT-compatible plain text (ready for VTT conversion)
 */
function assToSrt(text) {
  const lines = text.split(/\r?\n/);
  const srtBlocks = [];
  let index = 1;

  for (const line of lines) {
    if (!line.startsWith('Dialogue:')) continue;

    // ASS Dialogue: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
    const parts = line.split(',');
    if (parts.length < 10) continue;

    const startRaw = parts[1].trim();
    const endRaw   = parts[2].trim();
    const rawText  = parts.slice(9).join(',').trim();

    // Convert ASS timestamp (H:MM:SS.cs) → SRT (HH:MM:SS,mmm)
    const toSrtTs = (ts) => {
      const m = ts.match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/);
      if (!m) return null;
      const [, h, min, sec, cs] = m;
      const ms = String(parseInt(cs, 10) * 10).padStart(3, '0');
      return `${h.padStart(2, '0')}:${min}:${sec},${ms}`;
    };

    const start = toSrtTs(startRaw);
    const end   = toSrtTs(endRaw);
    if (!start || !end) continue;

    // Strip ASS override tags and convert line-break codes
    const clean = rawText
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\h/g, '\u00A0')
      .trim();

    if (!clean) continue;

    srtBlocks.push(`${index}\n${start} --> ${end}\n${clean}`);
    index++;
  }

  return srtBlocks.join('\n\n');
}

/**
 * Converts an SRT (or ASS/SSA) buffer to WebVTT format.
 *
 * @param {Buffer} buffer
 * @param {string} [lang] - ISO 639-2 language code hint for encoding detection
 * @returns {string} WebVTT content
 */
function srtToVtt(buffer, lang = '') {
  let text = decodeSrt(buffer, lang);

  // Already WebVTT — return as-is
  if (text.trimStart().startsWith('WEBVTT')) {
    return text;
  }

  // ASS/SSA — convert to SRT first, then fall through to VTT conversion
  if (text.trimStart().startsWith('[Script Info]')) {
    text = assToSrt(text);
    if (!text) return 'WEBVTT\n\n';
  }

  // Normalise line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Convert SRT timestamps (HH:MM:SS,mmm) → VTT (HH:MM:SS.mmm).
  // FIX: Only process lines that contain ' --> ' so dialogue text
  // like "At 00:01:02,500 he arrived" is never corrupted.
  const vttLines = text.split('\n').map(line => {
    if (line.includes(' --> ')) {
      return line.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    }
    return line;
  });

  return 'WEBVTT\n\n' + vttLines.join('\n');
}

module.exports = { decodeSrt, srtToVtt };
