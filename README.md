# Stremio Subtitle Hub Addon

A production-ready, serverless Stremio addon that gets subtitles from OpenSubtitles, SubDL, SubSource.

## Features
- **Parallel Fetching**: Queries all 4 providers concurrently with strict timeouts.
- **On-the-fly Conversion**: Extracts ZIP archives in memory and converts SRT to VTT.
- **Encoding Detection**: Automatically detects and fixes Eastern European diacritics (Romanian, etc.) using `chardet` and `iconv-lite`.
- **Stateless Architecture**: Fully compatible with Vercel's serverless environment. API keys are passed securely via Stremio's configuration URL pattern.

## Local Development
1. `npm install`
2. `npm run dev`
3. Open `http://localhost:7000/configure` in your browser.

## Vercel Deployment
1. Push this repository to GitHub.
2. Import the repository in your Vercel dashboard.
3. Vercel will automatically detect the `vercel.json` and deploy the serverless function.
4. No environment variables are required in Vercel (users provide their own API keys via the config page).

## Provider API Keys
- **OpenSubtitles**: Register at opensubtitles.com
- **SubDL**: Register at subdl.com -> API Key page
- **SubSource**: Register at subsource.net
