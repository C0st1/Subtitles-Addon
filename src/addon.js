const { addonBuilder } = require('stremio-addon-sdk');
const manifest = require('./manifest');
const subtitlesHandler = require('./handlers/subtitles');

const builder = new addonBuilder(manifest);

// Change this back to PLURAL: defineSubtitlesHandler
builder.defineSubtitlesHandler(subtitlesHandler);

module.exports = builder.getInterface();
