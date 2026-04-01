# Stremio Subtitle Hub Addon

A production-ready, serverless Stremio addon that fetches subtitles from OpenSubtitles, SubDL, and SubSource.

## Features

- **Parallel Fetching** — queries all 3 providers concurrently with strict 5-second timeouts; a slow or failing provider never blocks the others.
- **On-the-fly Conversion** — extracts ZIP/RAR archives in memory and converts SRT/ASS/SSA to WebVTT automatically.
- **ASS/SSA Support** — Advanced SubStation Alpha files are converted to WebVTT (styling tags stripped, timestamps translated).
- **Encoding Detection** — automatically detects and corrects Eastern European diacritics (Romanian, Hungarian, Polish, etc.) using `chardet` and `iconv-lite`.
- **SSRF Protection** — all external download URLs are validated against a trusted domain allow-list before being fetched.
- **Stateless Architecture** — fully compatible with Vercel's serverless environment; API keys are passed securely via Stremio's configuration URL.

## Supported Languages

`eng` `ron/rum` `fre/fra` `spa` `ger/deu` `ita` `hun` `por` `gre`

> To request additional languages, add a mapping to `src/config/languages.js`.

## Local Development

```bash
npm install
npm run dev            # starts with nodemon (auto-restart on save)
# Open http://localhost:7000/configure
```

## Vercel Deployment

1. Push this repository to GitHub.
2. Import it in your Vercel dashboard.
3. Add an environment variable:
   ```
   ADDON_HOST=your-deployment.vercel.app
   ```
   This is **required** in production to prevent Host-header injection attacks. See `.env.example` for details.
4. Deploy — no other server-side config is needed. Users supply their own API keys via the configuration page.

## Provider API Keys

| Provider | Where to register |
|---|---|
| OpenSubtitles | opensubtitles.com → API section |
| SubDL | subdl.com → API Key page |
| SubSource | subsource.net |

## Security Notes

- **SSRF**: Download URLs returned by provider APIs are validated against a domain allow-list (`src/utils/validate.js`) before being fetched.
- **Host header**: The `ADDON_HOST` environment variable is the authoritative source for the addon's public URL in production. The `Host` header is only used as a fallback in local development.
- **API key redaction**: The structured logger automatically redacts any field whose key matches `api_key` (case-insensitive) so keys never appear in logs.
