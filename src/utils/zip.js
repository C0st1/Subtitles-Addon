const AdmZip = require('adm-zip');
const { createExtractorFromData } = require('node-unrar-js');

/** True if buffer starts with ZIP magic bytes (PK\x03\x04) */
function isZipBuffer(buffer) {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4B;
}

/** True if buffer starts with RAR4 or RAR5 magic bytes */
function isRarBuffer(buffer) {
  return (
    buffer.length >= 7 &&
    buffer[0] === 0x52 && buffer[1] === 0x61 &&
    buffer[2] === 0x72 && buffer[3] === 0x21 &&
    buffer[4] === 0x1A && buffer[5] === 0x07 &&
    (buffer[6] === 0x00 || buffer[6] === 0x01)
  );
}

async function listSrtFiles(buffer) {
  const srtFiles = [];

  if (isZipBuffer(buffer)) {
    const zip = new AdmZip(buffer);
    for (const entry of zip.getEntries()) {
      if (!entry.isDirectory && entry.entryName.toLowerCase().endsWith('.srt')) {
        srtFiles.push({ name: entry.entryName, data: entry.getData() });
      }
    }
    return srtFiles;
  }

  if (isRarBuffer(buffer)) {
    const uint8Array = new Uint8Array(buffer);
    const extractor = await createExtractorFromData({ data: uint8Array });

    const list = extractor.getFileList();
    const targetHeaders = Array.from(list.fileHeaders).filter(
      h => !h.flags.directory && h.name.toLowerCase().endsWith('.srt')
    );

    for (const header of targetHeaders) {
      const extracted = extractor.extract({ files: [header.name] });
      const files = Array.from(extracted.files);
      if (files.length && files[0].extraction) {
        srtFiles.push({ name: header.name, data: Buffer.from(files[0].extraction) });
      }
    }
    return srtFiles;
  }

  // Not a recognised archive — treat the buffer itself as a raw SRT
  return [{ name: 'original.srt', data: buffer }];
}

/**
 * Extracts the most relevant SRT file from a ZIP or RAR archive.
 *
 * Selection priority:
 *  1. Filename contains the requested language hint.
 *  2. Largest file (avoids 1KB promo/spam files).
 *
 * @param {Buffer} buffer
 * @param {string} [langHint] - ISO language code to help select the right file
 * @returns {Promise<Buffer>}
 */
async function extractSrt(buffer, langHint = '') {
  const files = await listSrtFiles(buffer);
  if (files.length === 0) throw new Error('No SRT file found in archive');
  if (files.length === 1) return files[0].data;

  if (langHint) {
    const lowerLang = langHint.toLowerCase();
    const short = lowerLang.substring(0, 2);
    const match = files.find(f => {
      const n = f.name.toLowerCase();
      return (
        n.includes(lowerLang) ||
        n.includes(`_${short}`) ||
        n.includes(`.${short}`) ||
        n.includes(`-${short}`)
      );
    });
    if (match) return match.data;
  }

  // Fallback: largest file
  return files.sort((a, b) => b.data.length - a.data.length)[0].data;
}

module.exports = { listSrtFiles, extractSrt };
