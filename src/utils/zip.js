const AdmZip = require('adm-zip');
const { createExtractorFromData } = require('node-unrar-js');

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
    // node-unrar-js prefers Uint8Array
    const uint8Array = new Uint8Array(buffer);
    const extractor = await createExtractorFromData({ data: uint8Array });
    
    // Convert generator to an array of headers
    const list = extractor.getFileList();
    const fileHeaders = Array.from(list.fileHeaders); 
    
    const srtFile = fileHeaders.find(h => 
      h.name.toLowerCase().endsWith('.srt') || h.name.toLowerCase().endsWith('.sub')
    );
    if (!srtFile) throw new Error('No SRT/SUB found in RAR');
    
    // FIX: Method is .extract() and returns a generator in 'files'
    const extracted = extractor.extract({ files: [srtFile.name] });
    const extractedFiles = Array.from(extracted.files); 
    
    if (!extractedFiles.length || !extractedFiles[0].extraction) {
      throw new Error('Failed to extract file content from RAR');
    }
    
    return Buffer.from(extractedFiles[0].extraction);
  }

  // If not an archive, return original buffer (assume it's raw SRT)
  return buffer;
}

module.exports = { extractSrt };
