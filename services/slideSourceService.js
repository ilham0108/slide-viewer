const fs = require('fs/promises');
const path = require('path');
const { UPLOAD_DIR } = require('../config/paths');
const slideModel = require('../models/slideModel');
const tileService = require('./tileService');
const logger = require('../utils/logger');

const log = logger.child('slides');
const UNREADABLE_MESSAGE = 'OpenSlide cannot read this file as a slide.';
// At startup the tile service may still be loading (npm run dev starts both together).
const STARTUP_WAIT_MS = 60 * 1000;

/** µm per pixel from the slide metadata, or null when it is missing or implausible. */
function readMpp(info) {
    const mpp = Number(info.mppX);
    return Number.isFinite(mpp) && mpp > 0 && mpp < 100 ? mpp : null;
}

/**
 * Asks the tile service to open an uploaded slide. Returns one of:
 *   { status: 'ready', magnification, mpp }
 *   { status: 'unreadable', errorMessage }   not a slide OpenSlide can read
 *   { status: 'failed', errorMessage }       tile service unavailable; checking again may work
 */
async function inspectSlide(slideName, jobLog = log) {
    try {
        const info = await tileService.getSlideInfo(slideName);
        if (!info) return { status: 'unreadable', errorMessage: UNREADABLE_MESSAGE };
        const mpp = readMpp(info);
        jobLog.info(`Slide ${slideName} opened by the tile service`, {
            width: info.width, height: info.height, magnification: info.magnification ?? 'unknown', mpp: mpp ?? 'unknown', vendor: info.vendor,
        });
        return { status: 'ready', magnification: info.magnification ?? null, mpp };
    } catch (error) {
        if (!(error instanceof tileService.TileServiceUnavailableError)) throw error;
        jobLog.error(`Tile service could not check slide ${slideName}`, { error });
        return { status: 'failed', errorMessage: error.message };
    }
}

/**
 * Registers a slide file saved in the upload folder: the tile service checks it and the
 * slide row is created. There is nothing to convert, so a readable file is ready at once.
 * An unreadable file is deleted. Returns { rejected: true } or { slideId, status, storedName }.
 */
async function registerUpload({ fileName, originalName, caseId = null, categoryId = null, uploadedBy }, jobLog = log) {
    const { slideName, storedName, sourcePath } = slideModel.getUploadPaths({
        filename: fileName,
        path: path.join(UPLOAD_DIR, fileName),
    });
    const removeUpload = async () => {
        try {
            await fs.unlink(sourcePath);
        } catch (error) {
            jobLog.warn('Failed to remove rejected upload', { input: sourcePath, error });
        }
    };

    let inspection;
    try {
        inspection = await inspectSlide(slideName, jobLog);
    } catch (error) {
        await removeUpload();
        throw error;
    }
    if (inspection.status === 'unreadable') {
        jobLog.warn(`Upload rejected: ${originalName} is not a readable slide`, { file: fileName });
        await removeUpload();
        return { rejected: true };
    }

    let slideId;
    try {
        slideId = await slideModel.createSlide({
            storedName,
            originalName,
            sourceName: fileName,
            caseId,
            categoryId,
            uploadedBy,
            status: inspection.status,
            magnification: inspection.magnification,
            mpp: inspection.mpp,
            errorMessage: inspection.errorMessage,
        });
    } catch (error) {
        jobLog.error('Could not register upload in the database', { file: fileName, error });
        await removeUpload();
        throw error;
    }
    jobLog.info(`Upload registered as slide ${slideId}`, { file: fileName, status: inspection.status });
    return { slideId, status: inspection.status, storedName };
}

/**
 * Settles slides left in "processing" by the earlier vips conversion, which no longer
 * runs: they become ready when the tile service can open their kept source file.
 */
async function settleProcessingSlides() {
    const slides = await slideModel.getProcessingSlides();
    if (!slides.length) return;

    log.info(`Checking ${slides.length} slide(s) left in processing by the old conversion`);
    try {
        await tileService.waitUntilAvailable(STARTUP_WAIT_MS);
    } catch (error) {
        log.warn('Tile service is not available; slides stay in processing until the next start', { error });
        return;
    }

    for (const slide of slides) {
        try {
            await fs.access(slideModel.getSourcePath(slide));
        } catch {
            log.warn(`Slide ${slide.id} has no source file; marking it failed`, { source: slide.source_name });
            await slideModel.markSlideFailed(slide.id, 'Source file not found.');
            continue;
        }
        const result = await inspectSlide(slideModel.getSlideName(slide));
        if (result.status === 'ready') {
            await slideModel.markSlideReady(slide.id, result.magnification, result.mpp);
            log.info(`Slide ${slide.id} is ready`);
        } else {
            await slideModel.markSlideFailed(slide.id, result.errorMessage);
        }
    }
}

/**
 * Reads the µm per pixel of slides uploaded before it was stored, so their scale and
 * measurements become exact. Slides without a kept source file keep the estimate.
 */
async function fillMissingMpp() {
    const slides = await slideModel.getSlidesMissingMpp();
    if (!slides.length) return;

    try {
        await tileService.waitUntilAvailable(STARTUP_WAIT_MS);
    } catch (error) {
        log.warn('Tile service is not available; slide mpp is filled in on the next start', { error });
        return;
    }

    let filled = 0;
    for (const slide of slides) {
        try {
            await fs.access(slideModel.getSourcePath(slide));
            const info = await tileService.getSlideInfo(slideModel.getSlideName(slide));
            const mpp = info && readMpp(info);
            if (!mpp) continue;
            await slideModel.setSlideMpp(slide.id, mpp);
            filled += 1;
        } catch (error) {
            log.warn(`Could not read mpp of slide ${slide.id}`, { error });
        }
    }
    log.info(`Slide mpp read for ${filled} of ${slides.length} slide(s)`);
}

module.exports = {
    inspectSlide,
    registerUpload,
    settleProcessingSlides,
    fillMissingMpp,
};
