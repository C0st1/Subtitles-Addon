# Subtitle Hub

A production-ready Stremio addon that aggregates subtitles from multiple providers with machine translation fallback, configuration persistence, and intelligent quality ranking.

[![Tests](https://img.shields.io/badge/tests-76%20pass-brightgreen)]()
[![Version](https://img.shields.io/badge/version-1.3.0-blue)]()
[![Node](https://img.shields.io/badge/node-%3E%3D18.x-green)]()
[![License](https://img.shields.io/badge/license-MIT-grey)]()

## Features

### Subtitle Providers
- **OpenSubtitles** — largest subtitle database, requires free API key
- **SubDL** — fast-growing community, requires free API key
- **SubSource** — updated to v1 API with IMDB-based search, requires API key
- **Addic7ed** — TV-focused provider, requires username & password

### Machine Translation Fallback
When no subtitles are found for your requested language, the addon automatically fetches the most downloaded English subtitle from OpenSubtitles and translates it on-the-fly using Google Translate (free, no API key needed). Alternative backends available: DeepL, LibreTranslate (self-hosted).

### Configuration Persistence
Every installation gets a unique URL encoded with its config — API keys, language preferences, and toggle settings are all baked into the install link. The addon remembers your setup with no account needed.

### Quality & Matching
- **Download-based ranking** — MT source subtitles are selected by popularity from OpenSubtitles
- **Release name matching** — boosts subtitles that match your video filename
- **HI/SDH filtering** — optionally exclude hearing-impaired subtitles
- **Provider priority** — choose the order providers are queried and results displayed
- **Provider failover** — automatically skips unhealthy providers after 3 consecutive failures

### Format & Encoding
- On-the-fly **SRT / ASS / SSA → WebVTT** conversion
- In-memory **ZIP and RAR** extraction (no temp files)
- Automatic **encoding detection** with chardet + iconv-lite, including Eastern European fixups
- CRLF, LF, and mixed line ending support

### Security
- Helmet security headers with CSP nonces
- SSRF protection with domain allowlist + async DNS resolution checks
- Config key whitelist validation (prevents injection via encoded config)
- API keys are resolved server-side, never exposed in subtitle URLs
- Global + per-user rate limiting (sliding window)
- Zip bomb protection (entry count, per-file size, total size limits)
- Structured JSON logging with sensitive data redaction
- Optional AES-256-GCM encryption for config API keys

### Operations
- **Redis** or in-memory LRU caching (24h TTL)
- **Sentry** error monitoring integration
- **Docker** + **Docker Compose** support
- **CI/CD** via GitHub Actions
- Health check endpoint with cache/failover/analytics stats

### Internationalization
Configure page available in 8 languages: English, Romanian, French, Spanish, German, Italian, Portuguese, Arabic. Both the UI and community presets are fully translated.

### UI Features
- **4-step configuration wizard** with smooth transitions
- **Custom dark-themed language dropdown** with country flag emojis
- **Hoverable tooltips** with accessible "Get API Key" links
- **Drag-and-drop provider priority** reordering
- **Profile management** — save, load, and switch between configurations
- **Import/export** configuration as JSON
- **URL shortening** for sharing install links

## Quick Start

### Install in Stremio
1. Deploy the addon (see [Deployment](#deployment) below)
2. Copy your configured `stremio://` link from the configure page
3. Paste it into Stremio's search bar — done

### Local Development
```bash
git clone https://github.com/C0st1/Subtitles-Addon.git
cd Subtitles-Addon
npm install
cp .env.example .env    # Add your API keys
npm run dev
# Open http://localhost:7000/configure
```

## Deployment

### Vercel (Recommended)
1. Push to GitHub
2. Import in [Vercel Dashboard](https://vercel.com/new)
3. Set environment variables:
   - `OPENSUBTITLES_API_KEY`
   - `SUBDL_API_KEY`
   - `SUBSOURCE_API_KEY`
4. Deploy — Vercel auto-detects `vercel.json`

### Docker
```bash
docker build -t subtitle-hub .
docker run -p 7000:7000 \
  -e OPENSUBTITLES_API_KEY=your_key \
  -e SUBDL_API_KEY=your_key \
  -e SUBSOURCE_API_KEY=your_key \
  subtitle-hub
```

Or with Docker Compose:
```bash
docker compose up -d
```

### Manual / VPS
```bash
npm install --production
NODE_ENV=production node src/index.js
```

## Configuration

All settings can be configured through the addon's built-in configure page (the gear icon in Stremio). Settings are persisted as a base64url-encoded path segment in your install URL.

| Setting | Type | Description |
|---------|------|-------------|
| **OpenSubtitles API Key** | text | Free API key from opensubtitles.com |
| **SubDL API Key** | text | Free API key from subdl.com |
| **SubSource API Key** | text | API key from subsource.net (required for v1 API) |
| **Languages** | text | Comma-separated ISO 639-2 codes (e.g. `eng,ron,fre`) |
| **Enabled Sources** | text | Comma-separated: `opensubtitles,subdl,subsource,addic7ed` |
| **Include HI Subtitles** | toggle | Show hearing-impaired / SDH subtitles |
| **Release Name Matching** | toggle | Boost subtitles matching your video filename |
| **Machine Translation** | toggle | Auto-translate English subs when none found |
| **Provider Priority** | text | Custom provider order (e.g. `subdl,opensubtitles,subsource`) |
| **Addic7ed Username** | text | Addic7ed login (for TV subtitles) |
| **Addic7ed Password** | text | Addic7ed password |
| **Profile Name** | text | Label for this configuration profile |

## Presets

The configure page offers 8 one-click presets for common language combinations. All presets are fully translated into the page's 8 supported languages.

| Preset | Languages |
|--------|-----------|
| 🌍 Default | English |
| 🇪🇺 European | English, French, German, Spanish, Italian, Portuguese |
| ❄️ Nordic | Swedish, Danish, Norwegian, Finnish |
| 🎌 Anime | Japanese, English |
| 🌎 Latin American | Spanish, Portuguese, English |
| 🏔️ Balkan | Romanian, Hungarian, Croatian, Serbian, Slovenian, Bulgarian |
| 🌏 Asian | Japanese, Korean, Chinese, Thai, Vietnamese, Indonesian |
| 🎯 Max Coverage | 15+ languages, all providers |

## Machine Translation

When enabled and no subtitles are found in your requested language, the addon:

1. Fetches English subtitles from **OpenSubtitles only** (most reliable quality)
2. Sorts them by **download count** (highest first) to pick the best quality source
3. Downloads and parses the subtitle file into structured cue blocks
4. Wraps each cue in numbered XML tags (`<1>...</1>`, `<2>...</2>`, etc.) and translates in batch chunks of 15 via Google Translate — Google preserves XML tags intact, preventing content from bleeding between cues
5. Extracts translated text from the preserved tags, rebuilding the subtitle with timestamps and structure intact
6. Converts to WebVTT format and serves with 24-hour caching

The translation uses a cue-based parser (not line-level) so multi-line cues stay intact even when the translation changes internal line count. If Google mangles the XML tags in any chunk, the original English cues are kept for that chunk to prevent corruption.

### Translation Backends

| Backend | Cost | API Key | Quality |
|---------|------|---------|---------|
| **Google** (default) | Free | None needed | Good |
| DeepL | 500k chars/mo free | Required | Best |
| LibreTranslate | Self-hosted | Required | Fair |

Set via `MT_SERVICE_TYPE` environment variable.

## Environment Variables

See [`.env.example`](.env.example) for the full list.

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENSUBTITLES_API_KEY` | — | OpenSubtitles API key |
| `SUBDL_API_KEY` | — | SubDL API key |
| `SUBSOURCE_API_KEY` | — | SubSource v1 API key |
| `MT_SERVICE_TYPE` | `google` | Translation backend: `google`, `deepl`, `libretranslate` |
| `MT_SERVICE_URL` | — | Custom MT endpoint (for DeepL/LibreTranslate) |
| `MT_SERVICE_KEY` | — | MT API key (for DeepL/LibreTranslate) |
| `REDIS_URL` | — | Redis connection string (enables persistent cache) |
| `SENTRY_DSN` | — | Sentry error monitoring DSN |
| `RATE_LIMIT_MAX` | `100` | Global requests per minute |
| `PER_USER_RATE_LIMIT` | `60` | Per-user requests per minute |
| `FORCE_PROTOCOL` | auto | Force `http` or `https` for proxy URLs |
| `ENC_SECRET` | — | AES-256-GCM key for encrypting API keys in config |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/manifest.json` | Stremio addon manifest |
| `GET` | `/:config/manifest.json` | Manifest with user config injected |
| `GET` | `/:config/configure` | Configure page with pre-filled values |
| `GET` | `/configure` | Configure page (no pre-fill) |
| `GET` | `/:config/subtitles/:type/:id.json` | Subtitle catalog for a movie/series |
| `GET` | `/subtitle/:provider/:id.:ext` | Subtitle proxy (download + convert) |
| `GET` | `/subtitle/translate/:payload.:ext` | Machine translation proxy |
| `GET` | `/health` | Health check with stats |
| `GET` | `/cache/stats` | Cache statistics |
| `POST` | `/cache/clear` | Clear all caches |
| `POST` | `/analytics/event` | Record analytics event |
| `POST` | `/api/shorten` | Shorten a URL |
| `GET` | `/api/presets` | List available presets |
| `GET` | `/api/i18n/:lang` | Get translations for a language |

## Project Structure

```
Subtitles-Addon/
├── src/
│   ├── index.js              # Express server, routes, MT translate proxy
│   ├── addon.js              # Stremio SDK interface
│   ├── manifest.js           # Addon metadata & config schema
│   ├── presets.json          # 8 configuration presets (with i18n)
│   ├── handlers/
│   │   └── subtitles.js      # Main subtitle handler with MT fallback
│   ├── routes/
│   │   └── subtitle-proxy.js # Generic subtitle download proxy
│   ├── providers/
│   │   ├── opensubtitles.js  # OpenSubtitles API
│   │   ├── subdl.js          # SubDL API
│   │   ├── subsource.js      # SubSource v1 API (IMDB search + ZIP download)
│   │   └── addic7ed.js       # Addic7ed TV subtitles
│   ├── config/
│   │   └── languages.js      # ISO 639-2 ↔ provider code mapping
│   ├── i18n/
│   │   ├── en.json           # English
│   │   ├── ro.json           # Romanian
│   │   ├── fr.json           # French
│   │   ├── es.json           # Spanish
│   │   ├── de.json           # German
│   │   ├── ar.json           # Arabic
│   └── utils/
│       ├── translation.js    # MT backends (Google, DeepL, LibreTranslate)
│       ├── converter.js      # SRT/ASS/VTT format conversion
│       ├── zip.js            # ZIP/RAR extraction with bomb protection
│       ├── http.js           # Axios client with keep-alive pooling
│       ├── url-validator.js  # SSRF protection (allowlist + DNS)
│       ├── logger.js         # Structured JSON logger with redaction
│       ├── imdb.js           # IMDB ID parser
│       └── encryption.js     # AES-256-GCM config encryption
├── public/
│   ├── configure.html        # Configuration wizard (dark theme, i18n, tooltips)
│   └── logo.png              # Addon logo
├── .github/workflows/ci.yml  # GitHub Actions CI
├── Dockerfile
├── docker-compose.yml
├── vercel.json
└── package.json
```

## Testing

```bash
# Run all 76 tests
npm test
```

Tests cover subtitle parsing, Google Translate response handling, XML tag-based batch translation safety, IMDB ID parsing, URL validation, SSRF protection, language mapping, encoding detection, archive detection, config encryption, provider failover, presets, and i18n.

## Getting API Keys

| Provider | Register at | Free Tier |
|----------|-------------|-----------|
| OpenSubtitles | [opensubtitles.com](https://www.opensubtitles.com/en/consumers) | 5 downloads/day |
| SubDL | [subdl.com](https://subdl.com/profile/api-key) | 100 downloads/day |
| SubSource | [subsource.net](https://www.subsource.net/) | Registration required |

## Security Architecture

- **Helmet** — standard security headers (CSP, X-Frame-Options, HSTS, etc.)
- **CSP Nonce** — inline scripts in configure page use cryptographic nonces
- **SSRF Protection** — domain allowlist + async DNS resolution to prevent DNS rebinding
- **Config Validation** — only whitelisted keys accepted from URL-encoded config
- **API Key Safety** — keys resolved from env vars server-side, never in URLs
- **Rate Limiting** — global (100/min) + per-user (60/min) sliding window
- **Archive Safety** — zip bomb protection (max 1000 entries, 50MB per file, 50MB total)
- **Log Security** — sensitive keys auto-redacted in structured JSON logs
- **Host Validation** — strict regex prevents Host header injection in config URLs

## License

[MIT](https://opensource.org/licenses/MIT)
