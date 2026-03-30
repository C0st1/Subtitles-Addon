const AdmZip = require('adm-zip');
const { createExtractorFromData } = require('unrar-js');

/**
 * Extracts the first SRT or SUB file from a ZIP or RAR buffer.
 * @param {Buffer} buffer 
 * @returns {Promise<Buffer>}
 */
async function extractSrt(buffer) {
  // Check for ZIP Magic Number (PK..)
  if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    const srtEntry = entries.find(e => 
      !e.isDirectory && 
      (e.entryName.toLowerCase().endsWith('.srt') || e.entryName.toLowerCase().endsWith('.sub'))
    );
    if (!srtEntry) throw new Error('No SRT/SUB found in ZIP');
    return srtEntry.getData();
  }

  // Check for RAR Magic Number (Rar!)
  if (buffer.toString('utf8', 0, 4) === 'Rar!') {
    const extractor = await createExtractorFromData(buffer);
    const list = extractor.getFileList();
    const srtFile = list.fileHeaders.find(h => 
      h.name.toLowerCase().endsWith('.srt') || h.name.toLowerCase().endsWith('.sub')
    );
    if (!srtFile) throw new Error('No SRT/SUB found in RAR');
    
    const extracted = extractor.extractFiles([srtFile.name]);
    return Buffer.from(extracted.files[0].extraction);
  }

  // If not an archive, return original buffer (assume it's raw SRT)
  return buffer;
}

module.exports = { extractSrt };
