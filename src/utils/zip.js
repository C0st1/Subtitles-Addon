'use strict';

const AdmZip = require('adm-zip');
const { createExtractorFromData } = require('node-unrar-js');

// Protection limits against zip bombs and resource exhaustion
const MAX_DECOMPRESSED_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_ENTRIES = 1000;
const MAX_SINGLE_FILE_SIZE = 10 * 1024 * 1024;  // 10MB per file

/**
 * Detect if a buffer is a ZIP or RAR archive.
 * @param {Buffer} buffer
 * @returns {'zip'|'rar'|null}
 */
function isArchive(buffer) {
  if (!buffer || buffer.length < 4) return null;

  // ZIP magic: PK\x03\x04 (0x50 0x4B 0x03 0x04)
  if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
    return 'zip';
  }

  // RAR magic: Rar! (0x52 0x61 0x72 0x21)
  if (buffer[0] === 0x52 && buffer[1] === 0x61 && buffer[2] === 0x72 && buffer[3] === 0x21) {
    return 'rar';
  }

  return null;
}

/**
 * Check if a buffer looks like it could be a valid subtitle text file.
 * Rejects obvious binary files.
 * @param {Buffer} buffer
 * @returns {boolean}
 */
function looksLikeSubtitle(buffer) {
  if (!buffer || buffer.length === 0) return false;
  if (buffer.length > MAX_SINGLE_FILE_SIZE) return false;

  // Check for common subtitle format markers in the first 1KB
  const header = buffer.slice(0, 1024).toString('utf8');
  const subtitleMarkers = [
    'WEBVTT', 'WEBVTT ',
    '[Script Info]', '[V4 Styles]', '[Events]',
    /\d{2}:\d{2}:\d{2}/,   // SRT timestamp pattern
    'Dialogue:',            // ASS/SSA marker
  ];

  return subtitleMarkers.some(marker => {
    if (marker instanceof RegExp) return marker.test(header);
    return header.includes(marker);
  });
}

async function listSrtFiles(buffer) {
  const archiveType = isArchive(buffer);

  if (archiveType === 'zip') {
    // Validate compressed size to prevent zip bombs
    if (buffer.length > MAX_DECOMPRESSED_SIZE * 10) {
      throw new Error(`Archive too large: ${buffer.length} bytes (max ${MAX_DECOMPRESSED_SIZE * 10})`);
    }

    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();

    if (entries.length > MAX_ENTRIES) {
      throw new Error(`Too many entries in archive: ${entries.length} (max ${MAX_ENTRIES})`);
    }

    const srtFiles = [];
    let totalSize = 0;

    for (const entry of entries) {
      if (!entry.isDirectory && entry.entryName.toLowerCase().endsWith('.srt')) {
        // Check individual file size
        if (entry.header.size > MAX_SINGLE_FILE_SIZE) {
          continue; // Skip oversized files instead of failing entirely
        }

        totalSize += entry.header.size;
        if (totalSize > MAX_DECOMPRESSED_SIZE) {
          throw new Error(`Total decompressed size exceeds limit (${MAX_DECOMPRESSED_SIZE} bytes)`);
        }

        srtFiles.push({ name: entry.entryName, data: entry.getData() });
      }
    }

    return srtFiles;
  }

  if (archiveType === 'rar') {
    if (buffer.length > MAX_DECOMPRESSED_SIZE * 10) {
      throw new Error(`Archive too large: ${buffer.length} bytes (max ${MAX_DECOMPRESSED_SIZE * 10})`);
    }

    const uint8Array = new Uint8Array(buffer);
    const extractor = await createExtractorFromData({ data: uint8Array });

    const list = extractor.getFileList();
    const fileHeaders = Array.from(list.fileHeaders);

    if (fileHeaders.length > MAX_ENTRIES) {
      throw new Error(`Too many entries in archive: ${fileHeaders.length} (max ${MAX_ENTRIES})`);
    }

    const targetHeaders = fileHeaders.filter(h =>
      !h.flags.directory && h.name.toLowerCase().endsWith('.srt')
    );

    const srtFiles = [];
    let totalSize = 0;

    for (const header of targetHeaders) {
      if (header.unpSize > MAX_SINGLE_FILE_SIZE) {
        continue; // Skip oversized files
      }

      totalSize += header.unpSize;
      if (totalSize > MAX_DECOMPRESSED_SIZE) {
        throw new Error(`Total decompressed size exceeds limit (${MAX_DECOMPRESSED_SIZE} bytes)`);
      }

      const extracted = extractor.extract({ files: [header.name] });
      const extractedFiles = Array.from(extracted.files);

      if (extractedFiles.length && extractedFiles[0].extraction) {
        srtFiles.push({ name: header.name, data: Buffer.from(extractedFiles[0].extraction) });
      }
    }

    return srtFiles;
  }

  // Not an archive - validate that it looks like a subtitle file
  if (!looksLikeSubtitle(buffer)) {
    throw new Error('Buffer is not a recognized archive or subtitle format');
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
      return lowerName.includes(lowerLang) ||
             lowerName.includes(`_${lowerLang.substring(0, 2)}`) ||
             lowerName.includes(`.${lowerLang.substring(0, 2)}`);
    });
    if (match) return match.data;
  }

  // 2. Fallback: Return the largest SRT file (avoids 1KB spam/promo files)
  return files.sort((a, b) => b.data.length - a.data.length)[0].data;
}

module.exports = { listSrtFiles, extractSrt, isArchive };
