const multer = require('multer');
const path = require('path');
const { UPLOAD_DIR } = require('./paths');

const ALLOWED_EXTENSIONS = new Set(['.svs', '.tif', '.tiff']);
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

function isAllowedSlideFile(fileName) {
    return ALLOWED_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

/** Name an upload is stored under: a timestamp keeps names unique and sortable. */
function storedUploadName(originalName) {
    return `${Date.now()}-${path.basename(originalName)}`;
}

const storage = multer.diskStorage({
    destination: (_, __, callback) => callback(null, UPLOAD_DIR),
    filename: (_, file, callback) => {
        callback(null, storedUploadName(file.originalname));
    },
});

// Reject unsupported files before multer writes them to disk.
function fileFilter(_, file, callback) {
    if (isAllowedSlideFile(file.originalname)) {
        return callback(null, true);
    }
    const error = new Error('Format file tidak didukung. Gunakan file .svs, .tif, atau .tiff.');
    error.status = 400;
    error.expose = true;
    callback(error);
}

module.exports = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: MAX_UPLOAD_BYTES,
    },
});
module.exports.MAX_UPLOAD_BYTES = MAX_UPLOAD_BYTES;
module.exports.isAllowedSlideFile = isAllowedSlideFile;
module.exports.storedUploadName = storedUploadName;
