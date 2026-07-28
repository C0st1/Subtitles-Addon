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
 * Strip ASS/SSA override tags from subtitle text.
 *
 * Many subtitle providers distribute subtitles in SRT or VTT format but still
 * embed ASS-style override blocks such as `{\an8}` (top-center alignment),
 * `{\pos(x,y)}` (positioning), `{\i1}...{\i0}` (italic), `{\b1}` (bold),
 * `{\fad(...)}` (fade), etc. These blocks are not understood by SRT/VTT
 * players and end up rendered as raw text on screen (e.g. "{\an8} Hello").
 *
 * This helper:
 *   1. Removes every `{...}` override block (including the closing `}`).
 *   2. Converts ASS hard line breaks (`\N` / `\n`) to real newlines.
 *   3. Trims leading/trailing whitespace left behind by removed tags on each
 *      line so the cue text starts cleanly.
 *
 * It is safe to call on already-clean SRT/VTT text — the regexes are no-ops
 * when no override blocks are present.
 *
 * @param {string} text - Subtitle text that may contain ASS override tags
 * @returns {string} Cleaned subtitle text
 */
function stripAssOverrideTags(text) {
  if (!text) return text;

  // Remove ASS override blocks: {\...} (covers {\an8}, {\pos(...)}, {\i1}, {\b0}, etc.)
  let cleaned = text.replace(/\{[^}]*\}/g, '');

  // Convert ASS hard line breaks (\N or \n inside dialogue text) to real newlines.
  // Do this AFTER stripping override blocks so we don't accidentally touch a `\N`
  // that was inside a tag (none of the standard tags use \N, but be safe).
  cleaned = cleaned.replace(/\\[Nn]/g, '\n');

  // Trim each line so leftover leading spaces (e.g. "{\an8} Hello" -> " Hello") are removed.
  cleaned = cleaned.split(/\r?\n/).map(l => l.replace(/[ \t]+$/g, '').replace(/^[ \t]+/g, '')).join('\n');

  return cleaned;
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
    // Strip ASS override tags and convert \N to newlines using the shared helper.
    let text = stripAssOverrideTags(parts[9]).trim();

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
 * Strips any ASS-style override tags (e.g. `{\an8}`, `{\pos(...)}`) that may be
 * embedded in SRT or VTT input so they don't appear as raw text on screen.
 * @param {Buffer} buffer - Raw subtitle file buffer
 * @param {string} lang - ISO 639-2 language code hint for encoding detection
 * @returns {string} WebVTT formatted subtitle text
 */
function srtToVtt(buffer, lang = '') {
  let text = decodeSrt(buffer, lang);
  const trimmed = text.trim();

  // Already VTT - strip ASS override tags and return
  if (trimmed.startsWith('WEBVTT')) {
    return stripAssOverrideTags(text);
  }

  // ASS/SSA format - convert to SRT first (which strips tags), then to VTT
  if (trimmed.startsWith('[Script Info]')) {
    text = assToSrt(text);
    return 'WEBVTT\n\n' + text;
  }

  // SRT format - strip ASS override tags (many providers embed `{\an8}` etc.
  // in SRT files), normalize line endings, then convert timestamps to VTT.
  text = stripAssOverrideTags(text);
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

  return 'WEBVTT\n\n' + text;
}

module.exports = { decodeSrt, srtToVtt, stripAssOverrideTags };
