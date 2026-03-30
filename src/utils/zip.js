const AdmZip = require('adm-zip');
const { createExtractorFromData } = require('node-unrar-js');

/**
 * Lists all SRT files found within a ZIP or RAR buffer.
 * Returns an array of objects containing the filename and the file data.
 * @param {Buffer} buffer 
 * @returns {Promise<Array<{name: string, data: Buffer}>>}
 */
async function listSrtFiles(buffer) {
  const srtFiles = [];

  // Check for ZIP Magic Number (PK..)
  if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    
    entries.forEach(entry => {
      if (!entry.isDirectory && entry.entryName.toLowerCase().endsWith('.srt')) {
        srtFiles.push({
          name: entry.entryName,
          data: entry.getData()
        });
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
        srtFiles.push({
          name: header.name,
          data: Buffer.from(extractedFiles[0].extraction)
        });
      }
    }
    return srtFiles;
  }

  // If it's not an archive, assume the buffer is a raw SRT file
  // and return it with a generic name
  return [{ name: 'original.srt', data: buffer }];
}

/**
 * Compatibility wrapper to extract the first SRT/SUB file (Legacy support)
 * @param {Buffer} buffer 
 * @returns {Promise<Buffer>}
 */
async function extractSrt(buffer) {
  const files = await listSrtFiles(buffer);
  if (files.length === 0) throw new Error('No SRT found in archive');
  return files[0].data;
}

module.exports = { listSrtFiles, extractSrt };
