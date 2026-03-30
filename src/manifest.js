module.exports = {
  id: "community.subtitle-aggregator",
  version: "1.0.0",
  name: "Subtitle Aggregator",
  logo: "https://raw.githubusercontent.com/C0st1/Subtitles-Addon/main/public/logo.svg",
  description: "Fetches subtitles from OpenSubtitles, SubDL, SubSource, and Subs.ro",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs:[],
  behaviorHints: { configurable: true, configurationRequired: true },
  config:[
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
      key: "subsro_api_key",
      type: "text",
      title: "Subs.ro API Key (required for Subs.ro)"
    },
    {
      key: "languages",
      type: "text",
      title: "Languages (comma-separated ISO 639-2 codes, e.g. eng,ron,fre)"
    },
    {
      key: "enabled_sources",
      type: "text",
      title: "Enabled sources (comma-separated: opensubtitles,subdl,subsource,subsro)"
    },
    {
      key: "force_encoding_detection",
      type: "checkbox",
      title: "Force Stremio local encoding detection (fallback for severe diacritic issues)"
    }
  ]
};
