'use strict';

module.exports = {
  id: "community.subtitle-hub",
  version: "1.3.0",
  name: "Subtitle Hub",
  // Serve logo from the addon's own domain (prevents broken logo if GitHub repo changes)
  logo: "https://raw.githubusercontent.com/C0st1/Subtitles-Addon/refs/heads/main/public/logo.png",
  description: "Fetches subtitles from OpenSubtitles, SubDL, SubSource, Addic7ed with machine translation fallback",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
  behaviorHints: { configurable: true, configurationRequired: true },
  config: [
    {
      key: "opensubtitles_api_key",
      type: "text",
      title: "OpenSubtitles API Key (optional)"
    },
    {
      key: "subdl_api_key",
      type: "text",
      title: "SubDL API Key (required for SubDL)"
    },
    {
      key: "subsource_api_key",
      type: "text",
      title: "SubSource API Key (required for SubSource)"
    },
    {
      key: "languages",
      type: "text",
      title: "Languages (comma-separated ISO 639-2 codes, e.g. eng,ron,fre)"
    },
    {
      key: "enabled_sources",
      type: "text",
      title: "Enabled sources (comma-separated: opensubtitles,subdl,subsource,addic7ed)"
    },
    {
      key: "hi_filter",
      type: "toggle",
      title: "Include HI Subtitles"
    },
    {
      key: "release_matching",
      type: "toggle",
      title: "Enable Release Name Matching"
    },
    {
      key: "mt_fallback",
      type: "toggle",
      title: "Machine Translation Fallback"
    },
    {
      key: "provider_priority",
      type: "text",
      title: "Provider Priority (comma-separated)"
    },
    {
      key: "addic7ed_username",
      type: "text",
      title: "Addic7ed Username"
    },
    {
      key: "addic7ed_password",
      type: "text",
      title: "Addic7ed Password"
    },
    {
      key: "profile_name",
      type: "text",
      title: "Profile Name"
    }
  ]
};
