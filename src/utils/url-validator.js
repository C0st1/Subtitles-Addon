'use strict';

const { URL } = require('url');
const dns = require('dns').promises;

// Allowlisted domains for subtitle downloads
const ALLOWED_DOMAINS = [
  'dl.subdl.com',
  'api.opensubtitles.com',
  'www.opensubtitles.com',
  'api.subsource.net'
];

// Allowlisted domains for any HTTP request (broader, for API calls)
const API_ALLOWED_DOMAINS = [
  'api.opensubtitles.com',
  'www.opensubtitles.com',
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

// DNS result cache to amortize lookup cost across requests (30-second TTL)
const DNS_CACHE_TTL_MS = 30_000;
const dnsCache = new Map();

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
 * Resolve a hostname and check DNS cache first.
 * Returns the list of resolved IPv4 addresses.
 * @param {string} hostname
 * @returns {string[]}
 */
async function resolveWithCache(hostname) {
  const cached = dnsCache.get(hostname);
  if (cached && Date.now() - cached.ts < DNS_CACHE_TTL_MS) {
    return cached.addresses;
  }

  const addresses = await dns.resolve4(hostname);
  dnsCache.set(hostname, { addresses, ts: Date.now() });

  // Prune stale entries periodically (every 100 lookups)
  if (dnsCache.size > 100) {
    const now = Date.now();
    for (const [key, val] of dnsCache) {
      if (now - val.ts >= DNS_CACHE_TTL_MS) dnsCache.delete(key);
    }
  }

  return addresses;
}

/**
 * Validates that a URL is safe to fetch (not SSRF).
 * Checks protocol, domain allowlist, and private IP ranges via DNS resolution.
 * @param {string} rawUrl - The URL to validate
 * @param {'download'|'api'} context - 'download' for subtitle files, 'api' for API calls
 * @returns {Promise<{ valid: boolean, reason?: string }>}
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
    const addresses = await resolveWithCache(hostname);
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

module.exports = { validateUrl, isPrivateIp };
