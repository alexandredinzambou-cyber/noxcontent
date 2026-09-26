const { serveHTTP } = require('stremio-addon-sdk');
const { buildAddonInterface } = require('./addon-handlers');
const { resolveBaseUrl, getBaseUrl } = require('./lib/utils');

// ── Start server ────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 7000;

// Resolve the current FS base URL from fstream.info, then start the server
resolveBaseUrl().then(() => {
    serveHTTP(buildAddonInterface(), { port: PORT });
    console.log(`FrenchStream addon running at http://localhost:${PORT}/manifest.json`);
    console.log(`Using FS base URL: ${getBaseUrl()}`);
});
