const AdmZip = require('adm-zip');

/**
 * Extracts the first SRT or SUB file from a ZIP buffer in memory.
 * @param {Buffer} zipBuffer 
 * @returns {Buffer}
 */
function extractSrt(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  
  const srtEntry = entries.find(e => 
    !e.isDirectory && 
    (e.entryName.toLowerCase().endsWith('.srt') || e.entryName.toLowerCase().endsWith('.sub'))
  );

  if (!srtEntry) throw new Error('No SRT/SUB file found in archive');
  return srtEntry.getData();
}

module.exports = { extractSrt };
