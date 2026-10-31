/**
 * Starts the Python tile service with the same .env as the Node server, so both agree on
 * the port and on the folder holding the uploaded slides.
 */
require('dotenv').config();

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ROOT_DIR, UPLOAD_DIR } = require('../config/paths');

const SERVICE_DIR = path.join(ROOT_DIR, 'tile-service');
const venvPython = process.platform === 'win32'
    ? path.join(SERVICE_DIR, '.venv', 'Scripts', 'python.exe')
    : path.join(SERVICE_DIR, '.venv', 'bin', 'python');

if (!fs.existsSync(venvPython)) {
    console.error(`Tile service is not installed (${venvPython} not found). See tile-service/README.md.`);
    process.exit(1);
}

const child = spawn(venvPython, [path.join(SERVICE_DIR, 'app.py')], {
    env: { SLIDE_SOURCE_DIR: UPLOAD_DIR, ...process.env },
    stdio: 'inherit',
    windowsHide: true,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
}
child.on('exit', code => process.exit(code ?? 1));
