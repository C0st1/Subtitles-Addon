'use strict';

const chardet = require('chardet');
const iconv = require('iconv-lite');

/**
 * Decodes the raw buffer using chardet and returns a clean UTF-8 string.
 * @param {Buffer} buffer - Raw subtitle file buffer
 * @param {string} lang - ISO 639-2 language code hint for encoding detection
 * @returns {string} Decoded UTF-8 text
 */
function decodeSrt(buffer, lang = '') {
  let encoding = chardet.detect(buffer) || 'utf8';

  // Fix chardet misidentifying Windows-1250 (Central/Eastern European) as Windows-1252
  const easternLangs = ['ron', 'rum', 'hun', 'cze', 'pol', 'slv', 'hrv', 'srp', 'bos'];
  if (easternLangs.includes(lang.toLowerCase()) &&
      ['ISO-8859-1', 'windows-1252'].includes(encoding)) {
    encoding = 'windows-1250';
  }

  if (!iconv.encodingExists(encoding)) {
    encoding = 'utf8';
  }

  let text = iconv.decode(buffer, encoding);
  return text.replace(/^\uFEFF/, ''); // Strip BOM
}

/**
 * Converts basic ASS/SSA subtitle format to SRT.
 * Extracts [Events] dialogue lines, converts timestamps, and strips formatting tags.
 * This is a best-effort conversion - complex ASS features (positioning, effects)
 * cannot be represented in SRT.
 * @param {string} assText - ASS/SSA formatted subtitle text
 * @returns {string} SRT formatted subtitle text
 */
function assToSrt(assText) {
  const lines = assText.split(/\r?\n/);
  const dialogues = [];
  let index = 1;

  for (const line of lines) {
    if (!line.startsWith('Dialogue:')) continue;

    // ASS format: Dialogue: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
    const parts = line.substring(9).split(',', 10);
    if (parts.length < 10) continue;

    const start = assTimestampToSrt(parts[1].trim());
    const end = assTimestampToSrt(parts[2].trim());
    let text = parts[9].trim();

    // Remove ASS formatting tags: {\...}, but preserve text content within simple tags
    text = text.replace(/\{[^}]*\}/g, '');
    // Convert ASS line breaks (\N) to SRT line breaks
    text = text.replace(/\\[Nn]/g, '\n');
    // Remove leading/trailing whitespace
    text = text.trim();

    if (text && start && end) {
      dialogues.push(`${index}\n${start},000 --> ${end},000\n${text}\n`);
      index++;
    }
  }

  return dialogues.join('\n');
}

/**
 * Convert ASS timestamp (H:MM:SS.CC) to SRT timestamp (HH:MM:SS,CCC).
 * @param {string} assTs - ASS timestamp e.g., "0:02:17.44"
 * @returns {string} SRT timestamp e.g., "00:02:17,440"
 */
function assTimestampToSrt(assTs) {
  const parts = assTs.split(':');
  if (parts.length !== 3) return '00:00:00';

  const h = parts[0].padStart(2, '0');
  const m = parts[1].padStart(2, '0');
  const secParts = parts[2].split('.');
  const s = secParts[0].padStart(2, '0');
  const ms = (secParts[1] || '0').padEnd(3, '0').substring(0, 3);

  return `${h}:${m}:${s},${ms}`;
}

/**
 * Convert SRT buffer to WebVTT format.
 * Handles SRT, ASS/SSA, and VTT input formats.
 * @param {Buffer} buffer - Raw subtitle file buffer
 * @param {string} lang - ISO 639-2 language code hint for encoding detection
 * @returns {string} WebVTT formatted subtitle text
 */
function srtToVtt(buffer, lang = '') {
  let text = decodeSrt(buffer, lang);
  const trimmed = text.trim();

  // Already VTT - return as-is
  if (trimmed.startsWith('WEBVTT')) {
    return text;
  }

  // ASS/SSA format - convert to SRT first, then to VTT
  if (trimmed.startsWith('[Script Info]')) {
    text = assToSrt(text);
    return 'WEBVTT\n\n' + text;
  }

  // SRT format - convert to VTT
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

  return 'WEBVTT\n\n' + text;
}

module.exports = { decodeSrt, srtToVtt };
