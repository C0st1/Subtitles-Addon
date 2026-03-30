const { addonBuilder } = require('stremio-addon-sdk');
const manifest = require('./manifest');
const subtitlesHandler = require('./handlers/subtitles');

const builder = new addonBuilder(manifest);

// FIX: Changed defineSubtitleHandler to defineSubtitlesHandler
builder.defineSubtitlesHandler(subtitlesHandler);

module.exports = builder.getInterface();
