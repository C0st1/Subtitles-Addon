const { addonBuilder } = require('stremio-addon-sdk');
const manifest = require('./manifest');
const subtitlesHandler = require('./handlers/subtitles');

const builder = new addonBuilder(manifest);

builder.defineSubtitleHandler(subtitlesHandler);

module.exports = builder.getInterface();
