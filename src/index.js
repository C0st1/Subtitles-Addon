const express = require('express');
const cors = require('cors');
const path = require('path');
const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('./addon');
const proxyRoute = require('./routes/subtitle-proxy');
const logger = require('./utils/logger');

const app = express();
app.use(cors());

// Serve the configuration page
app.use(express.static(path.join(__dirname, '../public')));
app.get('/', (req, res) => res.redirect('/configure.html'));
app.get('/configure', (req, res) => res.redirect('/configure.html'));

// Mount the custom subtitle proxy route
// We use a query parameter ?config=... to pass the user's API keys statelessly
app.get('/subtitle/:provider/:subtitleId.vtt', proxyRoute);

// Mount the Stremio Addon SDK router
const addonRouter = getRouter(addonInterface);
app.use('/', addonRouter);

// Local development server
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  const PORT = process.env.PORT || 7000;
  app.listen(PORT, () => {
    logger.info('system', `Addon running at http://localhost:${PORT}`);
    logger.info('system', `Configure at http://localhost:${PORT}/configure`);
  });
}

// Export for Vercel serverless
module.exports = app;
