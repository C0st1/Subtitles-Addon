'use strict';

const { URL } = require('url');
const net = require('net');
const dns = require('dns').promises;

// Allowlisted domains for subtitle downloads
const ALLOWED_DOMAINS = [
  'dl.subdl.com',
  'api.opensubtitles.com',
  'api.subsource.net'
];

// Allowlisted domains for any HTTP request (broader, for API calls)
const API_ALLOWED_DOMAINS = [
  'api.opensubtitles.com',
  'api.subdl.com',
  'api.subsource.net',
  'v3-cinemeta.strem.io'
];

// Private IP ranges
const PRIVATE_RANGES = [
  { start: '0.0.0.0', end: '0.255.255.255' },
  { start: '10.0.0.0', end: '10.255.255.255' },
  { start: '127.0.0.0', end: '127.255.255.255' },
  { start: '169.254.0.0', end: '169.254.255.255' },
  { start: '172.16.0.0', end: '172.31.255.255' },
  { start: '192.0.0.0', end: '192.0.0.255' },
  { start: '192.0.2.0', end: '192.0.2.255' },
  { start: '192.168.0.0', end: '192.168.255.255' },
  { start: '198.18.0.0', end: '198.19.255.255' },
  { start: '198.51.100.0', end: '198.51.100.255' },
  { start: '203.0.113.0', end: '203.0.113.255' },
  { start: '224.0.0.0', end: '255.255.255.255' }
];

function ipToLong(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isPrivateIp(ip) {
  const long = ipToLong(ip);
  return PRIVATE_RANGES.some(range =>
    long >= ipToLong(range.start) && long <= ipToLong(range.end)
  );
}

/**
 * Validates that a URL is safe to fetch (not SSRF).
 * Checks protocol, domain allowlist, and private IP ranges.
 * @param {string} rawUrl - The URL to validate
 * @param {'download'|'api'} context - 'download' for subtitle files, 'api' for API calls
 * @returns {{ valid: boolean, reason?: string }}
 */
async function validateUrl(rawUrl, context = 'download') {
  // Must be valid URL
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (e) {
    return { valid: false, reason: 'Invalid URL format' };
  }

  // Only allow HTTPS (no http:// for external requests)
  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Only HTTPS protocol is allowed' };
  }

  const hostname = parsed.hostname.toLowerCase();
  const allowlist = context === 'download' ? ALLOWED_DOMAINS : API_ALLOWED_DOMAINS;

  // Check domain allowlist
  const isAllowed = allowlist.some(domain =>
    hostname === domain || hostname.endsWith('.' + domain)
  );

  if (!isAllowed) {
    return { valid: false, reason: `Domain not allowed: ${hostname}` };
  }

  // DNS resolution check to prevent IP-based bypass (e.g., DNS rebinding)
  try {
    const addresses = await dns.resolve4(hostname);
    for (const addr of addresses) {
      if (isPrivateIp(addr)) {
        return { valid: false, reason: `Domain resolves to private IP: ${addr}` };
      }
    }
  } catch (e) {
    // DNS resolution failed - reject to be safe
    return { valid: false, reason: `DNS resolution failed for: ${hostname}` };
  }

  return { valid: true };
}

/**
 * Validates a URL for download context (subtitle files).
 * Synchronous version that only checks domain allowlist and format (no DNS check).
 * Use this when DNS checks are too slow for the use case.
 * @param {string} rawUrl
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateUrlSync(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (e) {
    return { valid: false, reason: 'Invalid URL format' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Only HTTPS protocol is allowed' };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isAllowed = ALLOWED_DOMAINS.some(domain =>
    hostname === domain || hostname.endsWith('.' + domain)
  );

  if (!isAllowed) {
    return { valid: false, reason: `Domain not allowed: ${hostname}` };
  }

  return { valid: true };
}

module.exports = { validateUrl, validateUrlSync, isPrivateIp };
