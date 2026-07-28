/**
 * Subtitle Format Converter and Sanitizer
 * Comprehensive utility for converting between SRT and WebVTT formats,
 * normalizing timestamps, cleaning empty cues, and stripping unwanted formatting tags.
 */

// Strip ASS/SSA override tags such as {\an8}, {\pos(x,y)}, {\c&H000000&}, etc.
const ASS_TAG_REGEX = /\{\\[^}]+\}/g;

// Strip standard HTML formatting tags if needed (<i>, <b>, <u>, <font>, etc.)
const HTML_TAG_REGEX = /<\/?[^>]+(>|$)/g;

/**
 * Removes ASS/SSA positioning and formatting tags from subtitle text.
 * @param {string} text - Raw subtitle string
 * @param {boolean} [stripHtml=false] - Whether to also strip HTML tags
 * @returns {string} - Cleaned subtitle string
 */
function cleanSubtitleText(text, stripHtml = false) {
    if (!text || typeof text !== 'string') return '';
    
    // Remove {\an1} through {\an9} and all other ASS/SSA formatting overrides
    let cleaned = text.replace(ASS_TAG_REGEX, '');
    
    if (stripHtml) {
        cleaned = cleaned.replace(HTML_TAG_REGEX, '');
    }
    
    return cleaned.trim();
}

/**
 * Normalizes line endings and removes Byte Order Marks (BOM).
 * @param {string} content - Raw file content
 * @returns {string} - Normalized string
 */
function normalizeContent(content) {
    if (!content) return '';
    return content
        .replace(/^\uFEFF/, '') // Remove UTF-8 BOM if present
        .replace(/\r\n|\r/g, '\n'); // Normalize carriage returns to standard newlines
}

/**
 * Converts SRT subtitle content to WebVTT format.
 * Handles timestamp conversion, ASS tag stripping, and structure cleanup.
 * @param {string} srtContent - Raw SRT subtitle string
 * @returns {string} - Converted WebVTT string
 */
function srtToVtt(srtContent) {
    if (!srtContent) return '';

    let cleaned = normalizeContent(srtContent);

    // Split into subtitle cue blocks
    const blocks = cleaned.split('\n\n');
    const vttCues = [];

    for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 2) continue;

        // Check if the first line is an SRT cue index number and remove it
        let timestampLineIndex = 0;
        if (/^\d+$/.test(lines[0])) {
            timestampLineIndex = 1;
        }

        const timestampLine = lines[timestampLineIndex];
        if (!timestampLine || !timestampLine.includes('-->')) continue;

        // Convert SRT commas to VTT periods in timestamps (00:00:00,000 --> 00:00:00.000)
        const vttTimestamp = timestampLine.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

        // Extract and clean the actual dialogue text
        const dialogueLines = lines.slice(timestampLineIndex + 1);
        const cleanedDialogue = dialogueLines
            .map(line => cleanSubtitleText(line))
            .filter(line => line.length > 0)
            .join('\n');

        // Only add cue if there is dialogue remaining after cleaning
        if (cleanedDialogue) {
            vttCues.push(`${vttTimestamp}\n${cleanedDialogue}`);
        }
    }

    return 'WEBVTT\n\n' + vttCues.join('\n\n');
}

/**
 * Converts WebVTT subtitle content back to standard SRT format.
 * @param {string} vttContent - Raw WebVTT subtitle string
 * @returns {string} - Converted SRT string
 */
function vttToSrt(vttContent) {
    if (!vttContent) return '';

    let cleaned = normalizeContent(vttContent);
    
    // Strip WEBVTT header, NOTE blocks, and STYLE blocks
    cleaned = cleaned
        .replace(/^WEBVTT[^\n]*\n+/i, '')
        .replace(/^NOTE[\s\S]*?(?=\n\n|$)/gim, '')
        .replace(/^STYLE[\s\S]*?(?=\n\n|$)/gim, '');

    const blocks = cleaned.split('\n\n');
    const srtCues = [];
    let cueCounter = 1;

    for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 2) continue;

        // Find which line contains the timestamp arrow
        const timestampIndex = lines.findIndex(line => line.includes('-->'));
        if (timestampIndex === -1) continue;

        // Convert VTT periods back to SRT commas in timestamps
        const srtTimestamp = lines[timestampIndex].replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2');

        const dialogueLines = lines.slice(timestampIndex + 1);
        const cleanedDialogue = dialogueLines
            .map(line => cleanSubtitleText(line))
            .filter(line => line.length > 0)
            .join('\n');

        if (cleanedDialogue) {
            srtCues.push(`${cueCounter}\n${srtTimestamp}\n${cleanedDialogue}`);
            cueCounter++;
        }
    }

    return srtCues.join('\n\n');
}

/**
 * Sanitizes an existing SRT string without converting its format.
 * @param {string} srtContent - Raw SRT string
 * @returns {string} - Sanitized SRT string
 */
function cleanSrt(srtContent) {
    if (!srtContent) return '';
    return vttToSrt(srtToVtt(srtContent)); // Cycle through parser to guarantee clean formatting
}

module.exports = {
    cleanSubtitleText,
    normalizeContent,
    srtToVtt,
    vttToSrt,
    cleanSrt,
    ASS_TAG_REGEX,
    HTML_TAG_REGEX
};