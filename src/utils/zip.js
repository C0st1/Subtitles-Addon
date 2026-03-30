const AdmZip = require('adm-zip');
const { createExtractorFromData } = require('node-unrar-js');

async function listSrtFiles(buffer) {
  const srtFiles = [];

  // Check for ZIP Magic Number (PK..)
  if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    
    entries.forEach(entry => {
      if (!entry.isDirectory && entry.entryName.toLowerCase().endsWith('.srt')) {
        srtFiles.push({ name: entry.entryName, data: entry.getData() });
      }
    });
    return srtFiles;
  }

  // Check for RAR Magic Number (Rar!)
  if (buffer.toString('utf8', 0, 4) === 'Rar!') {
    const uint8Array = new Uint8Array(buffer);
    const extractor = await createExtractorFromData({ data: uint8Array });
    
    const list = extractor.getFileList();
    const fileHeaders = Array.from(list.fileHeaders); 
    
    const targetHeaders = fileHeaders.filter(h => 
      !h.flags.directory && h.name.toLowerCase().endsWith('.srt')
    );

    for (const header of targetHeaders) {
      const extracted = extractor.extract({ files: [header.name] });
      const extractedFiles = Array.from(extracted.files);
      
      if (extractedFiles.length && extractedFiles[0].extraction) {
        srtFiles.push({ name: header.name, data: Buffer.from(extractedFiles[0].extraction) });
      }
    }
    return srtFiles;
  }

  return [{ name: 'original.srt', data: buffer }];
}

/**
 * Extracts the most relevant SRT file from an archive.
 * @param {Buffer} buffer 
 * @param {string} [langHint] - Optional ISO language code to help pick the right file
 * @returns {Promise<Buffer>}
 */
async function extractSrt(buffer, langHint = '') {
  const files = await listSrtFiles(buffer);
  if (files.length === 0) throw new Error('No SRT found in archive');
  if (files.length === 1) return files[0].data;

  // 1. Attempt to match the file name with the requested language hint
  if (langHint) {
    const lowerLang = langHint.toLowerCase();
    const match = files.find(f => {
      const lowerName = f.name.toLowerCase();
      // Look for indicators like "_en", ".eng.", "-ro." etc.
      return lowerName.includes(lowerLang) || lowerName.includes(`_${lowerLang.substring(0,2)}`) || lowerName.includes(`.${lowerLang.substring(0,2)}`);
    });
    if (match) return match.data;
  }

  // 2. Fallback: Return the largest SRT file (avoids 1KB spam/promo files)
  return files.sort((a, b) => b.data.length - a.data.length)[0].data;
}

module.exports = { listSrtFiles, extractSrt };
