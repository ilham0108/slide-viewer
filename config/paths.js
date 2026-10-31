const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const UPLOAD_DIR = path.join(ROOT_DIR, 'uploads');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const SLIDE_DIR = path.join(PUBLIC_DIR, 'slides');
// Uploaded logo; public because the login page shows it before anyone signs in.
const BRANDING_DIR = path.join(PUBLIC_DIR, 'branding');
const LEGACY_DZI_DIR = SLIDE_DIR;
const LOG_DIR = process.env.LOG_DIR ? path.resolve(ROOT_DIR, process.env.LOG_DIR) : path.join(ROOT_DIR, 'logs');
const CLIENT_DIR = path.join(ROOT_DIR, 'client');
const CLIENT_DIST_DIR = path.join(CLIENT_DIR, 'dist');

module.exports = {
    ROOT_DIR,
    UPLOAD_DIR,
    PUBLIC_DIR,
    SLIDE_DIR,
    BRANDING_DIR,
    LEGACY_DZI_DIR,
    LOG_DIR,
    CLIENT_DIR,
    CLIENT_DIST_DIR,
};
