'use strict';

module.exports = {
  id: "community.subtitle-hub",
  version: "1.1.0",
  name: "Subtitle Hub",
  // Serve logo from the addon's own domain (prevents broken logo if GitHub repo changes)
  logo: "/logo.png",
  description: "Fetches subtitles from OpenSubtitles, SubDL, SubSource",
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
      title: "Enabled sources (comma-separated: opensubtitles,subdl,subsource)"
    }
  ]
};
