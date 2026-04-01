'use strict';

/**
 * Parse a Stremio content ID into its components.
 * @param {string} id - e.g., "tt0111161" or "tt0903747:1:1"
 * @returns {{ imdbId: string, imdbIdFull: string, season: number|null, episode: number|null }}
 * @throws {Error} If the ID format is invalid
 */
function parseId(id) {
  const match = id.match(/^(tt\d+)(?::(\d+):(\d+))?$/);
  if (!match) throw new Error(`Invalid Stremio ID format`);
  return {
    imdbIdFull: match[1],
    imdbId: match[1].replace('tt', ''),
    season: match[2] ? parseInt(match[2], 10) : null,
    episode: match[3] ? parseInt(match[3], 10) : null,
  };
}

module.exports = { parseId };
