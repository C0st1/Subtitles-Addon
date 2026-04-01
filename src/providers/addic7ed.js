'use strict';
const logger = require('../utils/logger');
const { toProviderCode, fromProviderCode } = require('../config/languages');

/**
 * Addic7ed Provider
 * NOTE: Addic7ed does not have a public API and requires web scraping.
 * This is a structural implementation. Full scraping logic would need
 * a headless browser (Puppeteer/Playwright) which is not suitable for
 * Vercel serverless. This provider serves as a template for self-hosted
 * (Docker) deployments where Puppeteer can be used.
 */
module.exports = async (params) => {
  const { imdbId, season, episode, type, languages, config } = params;
  const username = config.addic7ed_username;
  
  if (!username) {
    logger.warn('addic7ed', 'No username configured, skipping provider');
    return [];
  }
  
  // Addic7ed primarily supports: English, French, Portuguese, Romanian, Spanish, Turkish
  const supportedLangs = ['eng', 'fre', 'por', 'ron', 'spa', 'tur'];
  const addic7edLangs = languages.filter(l => supportedLangs.includes(l));
  if (!addic7edLangs.length) {
    logger.warn('addic7ed', 'No supported languages, skipping');
    return [];
  }
  
  // TODO: Implement scraping logic for self-hosted deployments
  // This would require:
  // 1. Login with username/password
  // 2. Search by IMDB ID
  // 3. Parse subtitle listing page
  // 4. Extract download links and metadata
  // 5. Return results in standard format
  
  logger.info('addic7ed', 'Provider not yet fully implemented - requires scraping', { imdbId });
  return [];
};
