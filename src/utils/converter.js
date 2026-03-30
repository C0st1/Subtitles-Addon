const chardet = require('chardet');
const iconv = require('iconv-lite');

/**
 * Decodes the raw buffer using chardet and returns a clean UTF-8 string.
 */
function decodeSrt(buffer) {
  let encoding = chardet.detect(buffer) || 'utf8';
  
  if (['ISO-8859-1', 'windows-1252'].includes(encoding)) {
    encoding = 'windows-1250'; 
  }

  let text = iconv.decode(buffer, iconv.encodingExists(encoding) ? encoding : 'utf8');
  return text.replace(/^\uFEFF/, ''); // Strip BOM
}

/**
 * Convert SRT buffer to WebVTT format.
 */
function srtToVtt(buffer) {
  let text = decodeSrt(buffer);

  // Check if it's already a VTT file or an Advanced SubStation Alpha (ASS) file
  if (text.trim().startsWith('WEBVTT') || text.trim().startsWith('[Script Info]')) {
    return text;
  }

  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

  return 'WEBVTT\n\n' + text;
}

module.exports = { decodeSrt, srtToVtt };
