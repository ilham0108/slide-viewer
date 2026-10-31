const fs = require('fs/promises');
const slideModel = require('../models/slideModel');
const caseModel = require('../models/caseModel');
const categoryModel = require('../models/categoryModel');
const userModel = require('../models/userModel');
const annotationService = require('../services/annotationService');
const slideSourceService = require('../services/slideSourceService');
const tileService = require('../services/tileService');
const uploadSessionService = require('../services/uploadSessionService');
const { MAX_UPLOAD_BYTES, isAllowedSlideFile } = require('../config/upload');
const { forgetSlide } = require('../middleware/blankTileMiddleware');
const { parseId, cleanString, readPage, badRequest, notFound, conflict } = require('../utils/validation');
const logger = require('../utils/logger');

const uploadLog = logger.child('upload');
// Chunk size the browser is told to use for resumable uploads.
const CHUNK_BYTES = 8 * 1024 * 1024;
const slideLog = logger.child('slides');
const annotationLog = logger.child('annotation');

function serializeSlide(slide) {
    return {
        id: slide.id,
        name: slide.stored_name.replace(/\.dzi$/i, ''),
        originalName: slide.original_name,
        status: slide.status,
        progress: slide.progress,
        dzi: slide.status === 'ready' ? `/slides/${encodeURIComponent(slide.stored_name)}` : null,
        magnification: slide.magnification,
        // µm per pixel from the file; null for slides converted before it was stored.
        mpp: slide.mpp,
        createdAt: slide.created_at,
        case: slide.case_id
            ? {
                id: slide.case_id,
                caseNumber: slide.case_number,
                title: slide.case_title,
                categoryName: slide.category_name,
                categoryColor: slide.category_color,
            }
            : null,
        // Effective category (the case's, or the slide's own when it is in no case).
        category: slide.category_id
            ? { id: slide.category_id, name: slide.category_name, color: slide.category_color }
            : null,
    };
}

async function listSlides(req, res) {
    const caseId = req.query.caseId ? parseId(req.query.caseId) : null;
    const unassigned = req.query.unassigned === '1';
    // categoryId together with unassigned=1: slides placed in that category without a case.
    const categoryId = req.query.categoryId === 'none' ? 'none' : parseId(req.query.categoryId);
    const search = cleanString(req.query.search, 100) || null;
    const filters = { caseId, unassigned, categoryId, search };

    // ?page= asks for one page (the gallery); without it every slide comes back (pickers).
    const paging = readPage(req.query, GALLERY_PAGE_SIZE);
    if (!paging) {
        const slides = await slideModel.getAvailableSlides(filters);
        return res.json(slides.map(serializeSlide));
    }
    const [slides, total] = await Promise.all([
        slideModel.getAvailableSlides({ ...filters, limit: paging.pageSize, offset: paging.offset }),
        slideModel.countAvailableSlides(filters),
    ]);
    res.json({ slides: slides.map(serializeSlide), total, page: paging.page, pageSize: paging.pageSize });
}

// 48 fills whole rows of the card grid at the usual 4, 6 and 8 columns.
const GALLERY_PAGE_SIZE = 48;

/**
 * Folder-like tree for the sidebar: categories containing their cases, with ready-slide
 * counts at every level. Cases are only included for users who may view cases.
 */
async function getBrowseTree(req, res) {
    const withCases = req.user.permissions.has('cases.view');
    const [categories, cases, counts] = await Promise.all([
        categoryModel.listCategories(),
        withCases ? caseModel.listCases({}) : [],
        slideModel.getSlideCounts(),
    ]);

    const toNode = item => ({
        id: item.id,
        caseNumber: item.case_number,
        title: item.title,
        slideCount: counts.byCase.get(item.id) || 0,
    });
    const casesOf = categoryId => cases
        .filter(item => item.category_id === categoryId)
        .map(toNode)
        .sort((a, b) => a.caseNumber.localeCompare(b.caseNumber, 'id', { numeric: true }));
    const sum = nodes => nodes.reduce((total, node) => total + node.slideCount, 0);

    const categoryNodes = categories.map(category => {
        const children = casesOf(category.id);
        const looseSlides = counts.byCategory.get(category.id) || 0;
        return {
            id: category.id,
            name: category.name,
            color: category.color,
            slideCount: sum(children) + looseSlides,
            looseSlideCount: looseSlides,
            cases: children,
        };
    });
    const uncategorized = casesOf(null);

    res.json({
        totalSlides: counts.total,
        unassignedSlides: counts.unassigned,
        categories: categoryNodes,
        uncategorized: { slideCount: sum(uncategorized), cases: uncategorized },
    });
}

async function getSlide(req, res) {
    const slideId = parseId(req.params.slideId);
    if (!slideId) return badRequest(res, 'ID slide tidak valid.');
    const slide = await slideModel.getSlideDetail(slideId);
    if (!slide) return notFound(res, 'Slide tidak ditemukan.');
    res.json({ slide: serializeSlide(slide) });
}

// After a large request body is read the client may already be gone, and then req.ip
// throws (its socket is detached); a log line must not fail the upload.
function clientIp(req) {
    try {
        return req.ip;
    } catch {
        return undefined;
    }
}

async function uploadSlide(req, res, next) {
    if (!req.file) {
        return badRequest(res, 'Pilih file slide untuk diunggah.');
    }

    uploadLog.info(`Upload received: ${req.file.originalname}`, {
        savedAs: req.file.filename,
        sizeMB: Number((req.file.size / 1024 / 1024).toFixed(1)),
        caseId: req.caseId,
        by: req.user.username,
        ip: clientIp(req),
    });

    let result;
    try {
        result = await slideSourceService.registerUpload({
            fileName: req.file.filename,
            originalName: req.file.originalname,
            caseId: req.caseId,
            uploadedBy: req.user.id,
        }, uploadLog);
    } catch (error) {
        return next(error);
    }
    sendUploadResult(res, result);
}

const UNREADABLE_UPLOAD_MESSAGE = 'File tidak dapat dibaca sebagai slide. Pastikan file tidak rusak dan formatnya didukung.';

function sendUploadResult(res, result, extra = {}) {
    if (result.rejected) return res.status(400).json({ success: false, ...extra, message: UNREADABLE_UPLOAD_MESSAGE });
    const ready = result.status === 'ready';
    res.status(201).json({
        success: true,
        ...extra,
        id: result.slideId,
        status: result.status,
        dzi: ready ? `/slides/${encodeURIComponent(result.storedName)}` : null,
        // A failed slide keeps its file, so "Periksa ulang" works once the tile service is back.
        message: ready
            ? 'Slide siap dilihat.'
            : 'File tersimpan, tetapi layanan tile sedang tidak tersedia. Gunakan "Periksa ulang" pada slide ini.',
    });
}

// ---- Resumable uploads -------------------------------------------------------
// POST /cases/:caseId/uploads starts a session, PATCH /uploads/:id sends one chunk at the
// offset given in the Upload-Offset header, GET /uploads/:id returns the offset to resume
// from, DELETE /uploads/:id cancels. The chunk that completes the file registers the slide.

/**
 * Starts a resumable upload of { fileName, size }. The destination is the case in the URL
 * (/cases/:caseId/uploads), or from the body (/uploads): { caseId } for a case, or
 * { categoryId } to place the slide in a category without a case.
 */
async function createUploadSession(req, res) {
    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName.trim() : '';
    const size = Number(req.body?.size);
    if (!fileName || fileName.length > 200) return badRequest(res, 'Nama file tidak valid.');
    if (!isAllowedSlideFile(fileName)) return badRequest(res, 'Format file tidak didukung. Gunakan file .svs, .tif, atau .tiff.');
    if (!Number.isSafeInteger(size) || size <= 0) return badRequest(res, 'Ukuran file tidak valid.');
    if (size > MAX_UPLOAD_BYTES) return res.status(413).json({ success: false, message: 'Ukuran file melebihi batas 5GB.' });

    let caseId = req.caseId || null;
    let categoryId = null;
    if (!caseId && req.body?.caseId !== undefined && req.body?.caseId !== null) {
        caseId = parseId(req.body.caseId);
        if (!caseId || !await caseModel.findById(caseId)) return notFound(res, 'Case tidak ditemukan.');
    } else if (!caseId) {
        categoryId = parseId(req.body?.categoryId);
        if (!categoryId) return badRequest(res, 'Pilih case atau kategori tujuan.');
        if (!await categoryModel.findById(categoryId)) return notFound(res, 'Kategori tidak ditemukan.');
    }

    const session = await uploadSessionService.createSession({ caseId, categoryId, userId: req.user.id, fileName, size });
    res.status(201).json({ success: true, id: session.id, offset: 0, size, chunkSize: CHUNK_BYTES });
}

async function getUploadSession(req, res) {
    const session = await uploadSessionService.getSession(req.params.uploadId, req.user.id);
    if (!session) return notFound(res, 'Sesi upload tidak ditemukan.');
    res.json({ success: true, id: session.id, offset: session.offset, size: session.size, chunkSize: CHUNK_BYTES });
}

async function uploadChunk(req, res, next) {
    const ip = clientIp(req);
    const session = await uploadSessionService.getSession(req.params.uploadId, req.user.id);
    if (!session) return notFound(res, 'Sesi upload tidak ditemukan.');
    const offset = Number(req.get('Upload-Offset'));
    if (!Number.isSafeInteger(offset) || offset < 0) return badRequest(res, 'Header Upload-Offset tidak valid.');

    let newOffset;
    try {
        newOffset = await uploadSessionService.appendChunk(session, offset, req);
    } catch (error) {
        if (error instanceof uploadSessionService.UploadSessionError) {
            return res.status(error.status).json({ success: false, message: error.message, offset: error.offset });
        }
        return next(error);
    }
    if (newOffset < session.size) return res.json({ success: true, offset: newOffset, complete: false });

    // The last chunk: the file is complete, so register it as a slide.
    const destinationExists = session.caseId
        ? await caseModel.findById(session.caseId)
        : await categoryModel.findById(session.categoryId);
    if (!destinationExists) {
        await uploadSessionService.deleteSession(session.id);
        // The code tells the browser this is final, unlike a session that is merely gone.
        return res.status(404).json({
            success: false,
            code: 'case_deleted',
            message: session.caseId ? 'Case tujuan sudah dihapus. Upload dibatalkan.' : 'Kategori tujuan sudah dihapus. Upload dibatalkan.',
        });
    }
    let result;
    try {
        const fileName = await uploadSessionService.completeSession(session);
        uploadLog.info(`Upload received: ${session.fileName}`, {
            savedAs: fileName,
            sizeMB: Number((session.size / 1024 / 1024).toFixed(1)),
            caseId: session.caseId,
            categoryId: session.categoryId,
            by: req.user.username,
            ip,
            session: session.id,
        });
        result = await slideSourceService.registerUpload({
            fileName,
            originalName: session.fileName,
            caseId: session.caseId,
            categoryId: session.categoryId,
            uploadedBy: req.user.id,
        }, uploadLog);
    } catch (error) {
        return next(error);
    }
    sendUploadResult(res, result, { offset: newOffset, complete: true });
}

/**
 * Unfinished uploads (chunks received, file not complete) for the uploads page: the user's
 * own, or everyone's for administrators, who also see who is uploading.
 */
async function listUploadSessions(req, res) {
    const sessions = await uploadSessionService.listSessions(req.user.isAdmin ? null : req.user.id);
    const cases = new Map();
    const categories = new Map();
    const users = new Map();
    const lookup = async (cache, id, find) => {
        if (!id) return null;
        if (!cache.has(id)) cache.set(id, await find(id));
        return cache.get(id);
    };

    const items = [];
    for (const session of sessions) {
        const caseRow = await lookup(cases, session.caseId, caseModel.findById);
        const category = await lookup(categories, session.categoryId, categoryModel.findById);
        const uploader = req.user.isAdmin ? await lookup(users, session.userId, userModel.findById) : null;
        items.push({
            id: session.id,
            fileName: session.fileName,
            size: session.size,
            offset: session.offset,
            // A chunk is arriving right now (an upload running in some browser tab).
            receiving: session.receiving,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            case: caseRow ? { id: caseRow.id, caseNumber: caseRow.case_number, title: caseRow.title } : null,
            category: category ? { id: category.id, name: category.name, color: category.color } : null,
            ...(req.user.isAdmin
                ? { uploadedBy: uploader ? { name: uploader.name, username: uploader.username } : null, mine: session.userId === req.user.id }
                : { mine: true }),
        });
    }
    res.json({ sessions: items });
}

async function cancelUploadSession(req, res) {
    // Administrators may also clear someone else's abandoned upload.
    const session = await uploadSessionService.getSession(req.params.uploadId, req.user.id, { anyUser: req.user.isAdmin });
    if (!session) return notFound(res, 'Sesi upload tidak ditemukan.');
    await uploadSessionService.deleteSession(session.id);
    uploadLog.info(`Upload cancelled: ${session.fileName}`, { session: session.id, receivedMB: Number((session.offset / 1024 / 1024).toFixed(1)) });
    res.status(204).end();
}

async function getSlideStatus(req, res) {
    const slideId = parseId(req.params.slideId);
    if (!slideId) return badRequest(res, 'ID slide tidak valid.');

    const slide = await slideModel.getSlideStatus(slideId);
    if (!slide) return notFound(res, 'Slide tidak ditemukan.');

    res.json({
        id: slide.id,
        status: slide.status,
        progress: slide.progress,
        magnification: slide.magnification,
        dzi: slide.status === 'ready' ? `/slides/${encodeURIComponent(slide.stored_name)}` : null,
        message: slide.status === 'failed' ? 'Slide tidak dapat dibuka. Periksa log server untuk detail.' : null,
    });
}

/**
 * Renames a slide, moves it to another case (caseId null = no case), or, for a slide in no
 * case, puts it in a category (categoryId; null = none).
 */
async function updateSlide(req, res) {
    const slideId = parseId(req.params.slideId);
    if (!slideId) return badRequest(res, 'ID slide tidak valid.');
    const slide = await slideModel.getSlideDetail(slideId);
    if (!slide) return notFound(res, 'Slide tidak ditemukan.');

    const originalName = req.body?.originalName === undefined
        ? slide.original_name
        : cleanString(req.body.originalName, 255);
    if (!originalName) return badRequest(res, 'Nama slide wajib diisi (maksimal 255 karakter).');

    let caseId = slide.case_id;
    if (req.body?.caseId !== undefined) {
        caseId = req.body.caseId === null ? null : parseId(req.body.caseId);
        if (req.body.caseId !== null && (!caseId || !await caseModel.findById(caseId))) {
            return badRequest(res, 'Case tujuan tidak ditemukan.');
        }
    }

    let categoryId = slide.direct_category_id;
    if (req.body?.categoryId !== undefined) {
        categoryId = req.body.categoryId === null ? null : parseId(req.body.categoryId);
        if (req.body.categoryId !== null && (!categoryId || !await categoryModel.findById(categoryId))) {
            return badRequest(res, 'Kategori tidak ditemukan.');
        }
    }

    await slideModel.updateSlide(slideId, { caseId, categoryId, originalName });
    slideLog.info(`Slide ${slideId} updated`, { caseId, categoryId: caseId ? null : categoryId, originalName, by: req.user.username });
    res.json({ slide: serializeSlide(await slideModel.getSlideDetail(slideId)) });
}

/** Deletes a slide row with its annotations, its source file and cached or converted tiles. */
async function removeSlide(slide, user) {
    await slideModel.deleteSlide(slide.id);
    const slideName = slideModel.getSlideName(slide);
    forgetSlide(slideName);
    // Windows cannot delete a file another process holds open, so the tile service must
    // close the slide before its source file is removed.
    try {
        await tileService.forgetSlide(slideName);
    } catch (error) {
        slideLog.warn(`Tile service could not release slide ${slide.id}`, { error });
    }
    try {
        await slideModel.removeSlideFiles(slide);
    } catch (error) {
        slideLog.warn(`Slide ${slide.id} deleted but some files could not be removed`, { error });
    }
    slideLog.info(`Slide ${slide.id} deleted: ${slide.original_name}`, { by: user.username });
}

async function deleteSlide(req, res) {
    const slideId = parseId(req.params.slideId);
    if (!slideId) return badRequest(res, 'ID slide tidak valid.');
    const slide = await slideModel.getSlideDetail(slideId);
    if (!slide) return notFound(res, 'Slide tidak ditemukan.');
    if (slide.status === 'processing') {
        return conflict(res, 'Slide sedang dikonversi. Tunggu hingga selesai sebelum menghapus.');
    }
    await removeSlide(slide, req.user);
    res.json({ success: true });
}

const MAX_BULK_DELETE = 200;

/** Deletes several slides: { ids: [...] }. Slides that are gone or still processing are skipped. */
async function deleteSlides(req, res) {
    const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(parseId))] : [];
    if (!ids.length || ids.includes(null)) return badRequest(res, 'Daftar slide tidak valid.');
    if (ids.length > MAX_BULK_DELETE) return badRequest(res, `Maksimal ${MAX_BULK_DELETE} slide sekali hapus.`);

    const deleted = [];
    const skipped = [];
    for (const id of ids) {
        const slide = await slideModel.getSlideDetail(id);
        if (!slide || slide.status === 'processing') {
            skipped.push(id);
            continue;
        }
        await removeSlide(slide, req.user);
        deleted.push(id);
    }
    slideLog.info(`${deleted.length} slide(s) deleted at once`, { skipped: skipped.length, by: req.user.username });
    res.json({ success: true, deleted, skipped });
}

const UPLOAD_PAGE_SIZE = 50;

async function sourceSizeOf(slide) {
    if (!slide.source_name) return null;
    try {
        return (await fs.stat(slideModel.getSourcePath(slide))).size;
    } catch {
        return null;
    }
}

/**
 * Every slide with its status, destination and file size, newest first, for the uploads
 * page (?search=&page=). Who uploaded a slide is only sent to administrators.
 */
async function listUploadedSlides(req, res) {
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const page = Math.max(1, parseId(req.query.page) || 1);
    const { total, rows } = await slideModel.listAllSlides({ search, limit: UPLOAD_PAGE_SIZE, offset: (page - 1) * UPLOAD_PAGE_SIZE });
    const slides = await Promise.all(rows.map(async row => ({
        ...serializeSlide(row),
        sizeBytes: await sourceSizeOf(row),
        errorMessage: row.status === 'failed' ? row.error_message : null,
        ...(req.user.isAdmin
            ? { uploadedBy: row.uploaded_by_name ? { name: row.uploaded_by_name, username: row.uploaded_by_username } : null }
            : {}),
    })));
    res.json({ slides, total, page, pageSize: UPLOAD_PAGE_SIZE, showUploader: Boolean(req.user.isAdmin) });
}

/**
 * Checks a failed slide again from its kept upload, for example after the tile service was
 * unavailable during the upload, or for a slide whose old vips conversion failed.
 */
async function recheckSlide(req, res) {
    const slideId = parseId(req.params.slideId);
    if (!slideId) return badRequest(res, 'ID slide tidak valid.');
    const slide = await slideModel.getSlideDetail(slideId);
    if (!slide) return notFound(res, 'Slide tidak ditemukan.');
    if (slide.status !== 'failed') return conflict(res, 'Hanya slide yang gagal dibuka yang dapat diperiksa ulang.');

    try {
        if (!slide.source_name) throw new Error('missing');
        await fs.access(slideModel.getSourcePath(slide));
    } catch {
        return conflict(res, 'File sumber slide ini sudah tidak ada. Hapus slide lalu unggah ulang.');
    }

    // A leftover DZI from an old conversion would be served instead of the tile service.
    await slideModel.removeSlideOutput(slide);
    const slideName = slideModel.getSlideName(slide);
    forgetSlide(slideName);

    const inspection = await slideSourceService.inspectSlide(slideName, slideLog);
    if (inspection.status === 'ready') {
        await slideModel.markSlideReady(slideId, inspection.magnification, inspection.mpp);
        slideLog.info(`Slide ${slideId} is ready after a recheck`, { by: req.user.username });
        return res.json({ success: true, status: 'ready', message: 'Slide siap dilihat.' });
    }

    await slideModel.markSlideFailed(slideId, inspection.errorMessage);
    slideLog.warn(`Slide ${slideId} still cannot be opened`, { reason: inspection.errorMessage, by: req.user.username });
    return inspection.status === 'unreadable'
        ? res.status(422).json({ success: false, message: 'File tidak dapat dibaca sebagai slide. Pastikan file tidak rusak dan formatnya didukung.' })
        : res.status(503).json({ success: false, message: 'Layanan tile sedang tidak tersedia. Coba lagi beberapa saat lagi.' });
}

async function getSlideAnnotations(req, res) {
    const slideId = parseId(req.params.slideId);
    if (!slideId) return badRequest(res, 'ID slide tidak valid.');

    const slide = await slideModel.getSlideById(slideId);
    if (!slide) return notFound(res, 'Slide tidak ditemukan.');

    res.json(await annotationService.getAnnotations(slideId));
}

/**
 * Saves the whole annotation list of a slide. `revision` must be the one returned when the
 * list was loaded; if someone saved in between the answer is 409 with the current revision.
 */
async function saveSlideAnnotations(req, res) {
    const slideId = parseId(req.params.slideId);
    if (!slideId) return badRequest(res, 'ID slide tidak valid.');
    if (!annotationService.validateAnnotations(req.body?.annotations)) {
        return badRequest(res, 'Data anotasi tidak valid atau melebihi batas.');
    }
    if (!Number.isInteger(req.body.revision)) return badRequest(res, 'Revisi anotasi tidak valid. Muat ulang halaman.');

    const slide = await slideModel.getSlideById(slideId);
    if (!slide) return notFound(res, 'Slide tidak ditemukan.');

    try {
        const saved = await annotationService.saveAnnotations(slideId, req.body.annotations, req.body.revision, {
            name: req.user.name,
            type: 'user',
        });
        annotationLog.info(`Annotations saved for slide ${slideId}`, {
            count: saved.annotations.length, revision: saved.revision, by: req.user.username, ip: req.ip,
        });
        res.json({ success: true, ...saved });
    } catch (error) {
        if (error instanceof annotationService.AnnotationConflictError) {
            return res.status(409).json({ success: false, conflict: true, revision: error.revision,
                message: 'Anotasi slide ini baru saja diubah orang lain. Muat ulang anotasi terlebih dahulu.' });
        }
        throw error;
    }
}

module.exports = {
    serializeSlide,
    listSlides,
    getBrowseTree,
    getSlide,
    uploadSlide,
    createUploadSession,
    getUploadSession,
    uploadChunk,
    cancelUploadSession,
    listUploadSessions,
    getSlideStatus,
    updateSlide,
    deleteSlide,
    deleteSlides,
    listUploadedSlides,
    recheckSlide,
    getSlideAnnotations,
    saveSlideAnnotations,
};
