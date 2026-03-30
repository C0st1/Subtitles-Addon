const chardet = require('chardet');
const iconv = require('iconv-lite');

/**
 * Convert SRT subtitle content to WebVTT format.
 * Handles encoding detection and conversion for non-UTF-8 files.
 * @param {Buffer} srtBuffer - Raw subtitle file buffer
 * @returns {string} VTT-formatted subtitle content
 */
function srtToVtt(srtBuffer) {
  let encoding = chardet.detect(srtBuffer) || 'utf8';
  
  if (['ISO-8859-1', 'windows-1252'].includes(encoding)) {
    encoding = 'windows-1250'; 
  }

  let text = iconv.decode(srtBuffer, iconv.encodingExists(encoding) ? encoding : 'utf8');

  // CRITICAL FIX: Strip hidden Byte Order Marks (BOM) which crash Stremio's VTT parser
  text = text.replace(/^\uFEFF/, '');

  // Check if it's already a VTT file
  if (text.trim().startsWith('WEBVTT')) {
    return text;
  }

  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

  return 'WEBVTT\n\n' + text;
}

module.exports = { srtToVtt };
