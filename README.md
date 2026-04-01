# Stremio Subtitle Aggregator Addon

A production-ready, serverless Stremio addon that aggregates subtitles from OpenSubtitles, SubDL, and SubSource.

## Features
- **Parallel Fetching**: Queries all 3 providers concurrently with strict timeouts.
- **On-the-fly Conversion**: Extracts ZIP archives in memory and converts SRT/ASS to VTT.
- **Encoding Detection**: Automatically detects and fixes Eastern European diacritics (Romanian, etc.) using `chardet` and `iconv-lite`.
- **Stateless Architecture**: Fully compatible with Vercel's serverless environment.
- **Security Hardened**: Helmet security headers, CSP with nonce, SSRF protection with DNS resolution checks, config key whitelist validation, rate limiting, and sensitive data redaction in logs.

## v1.2.0 Changes
- **Security**: Added `helmet` middleware with Content-Security-Policy and nonce-based inline script support
- **Security**: Replaced synchronous URL validation with async validation including DNS resolution checks (prevents DNS rebinding SSRF)
- **Security**: API keys are no longer embedded in subtitle proxy URLs; proxy uses env vars as the authoritative source
- **Security**: Added config key whitelist validation to prevent injection via base64-encoded config
- **Bug Fix**: Fixed cache key inconsistency in subtitle proxy (removed dead first cache check)
- **Bug Fix**: Fixed manifest logo URL to use relative path `/logo.png` instead of external GitHub URL
- **Bug Fix**: Added missing episode parameter to SubSource API calls for series content
- **Bug Fix**: Filter unsupported language codes before passing to provider APIs
- **Improvement**: Replaced `process.env.__REQUEST_ID__` global mutation with `AsyncLocalStorage` for request-scoped state
- **Improvement**: Added `/health` endpoint for monitoring and uptime checks
- **Improvement**: Added `express.json` body size limit (100kb)
- **Improvement**: Optimized `fromProviderCode` with O(1) reverse lookup cache
- **Tests**: Added 38 unit tests covering IMDB parsing, URL validation, language mapping, and archive detection

## Local Development
1. `npm install`
2. Create a `.env` file (see `.env.example`) or use the configure page
3. `npm run dev`
4. Open `http://localhost:7000/configure` in your browser.

## Running Tests
```bash
npm test
```

## Vercel Deployment
1. Push this repository to GitHub.
2. Import the repository in your Vercel dashboard.
3. Set environment variables for API keys in Vercel (recommended over URL-based config):
   - `OPENSUBTITLES_API_KEY`
   - `SUBDL_API_KEY`
   - `SUBSOURCE_API_KEY`
4. Vercel will automatically detect the `vercel.json` and deploy the serverless function.

## Provider API Keys
- **OpenSubtitles**: Register at opensubtitles.com
- **SubDL**: Register at subdl.com -> API Key page
- **SubSource**: Register at subsource.net

## Security Architecture
- **Helmet**: All standard security headers (CSP, X-Frame-Options, HSTS, etc.)
- **CSP Nonce**: Inline scripts in configure.html use cryptographic nonces
- **SSRF Protection**: Domain allowlist + async DNS resolution to prevent DNS rebinding
- **Config Validation**: Only whitelisted config keys are accepted from URL-encoded config
- **API Key Safety**: Subtitle proxy URLs no longer contain API keys; env vars are used instead
- **Rate Limiting**: Global (100/min) + stricter proxy limit (30/min)
- **Log Security**: Sensitive keys are automatically redacted in structured JSON logs
- **Archive Safety**: Zip bomb protection with entry count, per-file, and total size limits
