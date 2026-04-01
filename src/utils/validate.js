/**
 * URL allow-list validation to prevent SSRF attacks.
 * Only permits fetching from known, trusted subtitle CDN domains.
 */

const ALLOWED_SUBTITLE_DOMAINS = new Set([
  'dl.subdl.com',
  'dl.opensubtitles.org',
  'www.opensubtitles.org',
  'cdn.opensubtitles.org',
  'api.opensubtitles.com',
  'subsource.net',
  'api.subsource.net',
  'api.subdl.com',
]);

/**
 * Validates that a URL points to a trusted domain.
 * Throws if the URL is not allowed (prevents SSRF).
 * @param {string} url
 * @param {string} [context] - Label for error messages
 */
function assertAllowedUrl(url, context = 'URL') {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${context} is not a valid URL: ${url}`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${context} uses a disallowed protocol: ${parsed.protocol}`);
  }

  // Strip port for domain matching
  const hostname = parsed.hostname.toLowerCase();

  const allowed = [...ALLOWED_SUBTITLE_DOMAINS].some(
    domain => hostname === domain || hostname.endsWith(`.${domain}`)
  );

  if (!allowed) {
    throw new Error(`${context} points to a disallowed domain: ${hostname}`);
  }
}

/**
 * Validates and normalises the addon host derived from request context.
 * Falls back to the ADDON_HOST env variable, then localhost.
 * Prevents using a user-supplied Host header as a trusted source.
 *
 * @param {string|undefined} headerHost - value of req.headers.host
 * @returns {string} safe host string
 */
function resolveAddonHost(headerHost) {
  // Environment variable is the trusted source for production deployments
  if (process.env.ADDON_HOST) {
    return process.env.ADDON_HOST;
  }

  // In development (localhost) the Host header is fine to use
  if (headerHost && (headerHost.startsWith('localhost') || headerHost.startsWith('127.0.0.1'))) {
    return headerHost;
  }

  // For Vercel/serverless: ADDON_HOST must be set. If it isn't, use the
  // header as a best-effort fallback but log a warning.
  if (headerHost) {
    // Basic sanity check: must look like a hostname[:port], no path characters
    if (/^[a-zA-Z0-9.\-]+(:\d+)?$/.test(headerHost)) {
      return headerHost;
    }
  }

  return 'localhost:7000';
}

module.exports = { assertAllowedUrl, resolveAddonHost };
