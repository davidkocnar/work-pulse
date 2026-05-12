const path = require('path');

// In Electron builds WORKPULSE_DATA_DIR is set to app.getPath('userData')
// so user-writable files land in ~/Library/Application Support/WorkPulse
// instead of inside the app bundle. Falls back to project root for npm start.
module.exports = () => process.env.WORKPULSE_DATA_DIR || path.join(__dirname, '..');
