const bcrypt = require('bcryptjs');
const shareModel = require('../models/shareModel');
const caseModel = require('../models/caseModel');
const categoryModel = require('../models/categoryModel');
const annotationService = require('../services/annotationService');
const { resolveShare, isUnlocked } = require('../services/shareAccess');
const { parseId, badRequest, notFound } = require('../utils/validation');
const logger = require('../utils/logger');

const log = logger.child('public-share');

// Brute-force protection for share passwords, per token and IP.
const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;
const failedUnlocks = new Map();

const GONE_MESSAGES = {
    missing: 'Link tidak ditemukan.',
    revoked: 'Link ini sudah dicabut oleh pemiliknya.',
    expired: 'Masa berlaku link ini sudah habis.',
};

/** Loads the share for :token and answers 404/410 when it cannot be used. */
async function loadActiveShare(req, res) {
    const resolved = await resolveShare(req.params.token);
    if (resolved.state !== 'active') {
        res.status(resolved.state === 'missing' ? 404 : 410).json({ success: false, state: resolved.state, message: GONE_MESSAGES[resolved.state] });
        return null;
    }
    return resolved;
}

function publicSlide(slide, token) {
    return {
        id: slide.id,
        name: slide.stored_name.replace(/\.dzi$/i, ''),
        originalName: slide.original_name,
        magnification: slide.magnification,
        mpp: slide.mpp,
        createdAt: slide.created_at,
        status: 'ready',
        dzi: `/share-tiles/${token}/${encodeURIComponent(slide.stored_name)}`,
        caseId: slide.case_id,
        case: slide.case_id
            ? { id: slide.case_id, caseNumber: slide.case_number, title: slide.case_title, categoryColor: slide.category_color }
            : null,
    };
}

function publicCase(row, hideClinical) {
    return {
        id: row.id,
        caseNumber: row.case_number,
        title: row.title,
        status: row.status,
        category: row.category_id ? { id: row.category_id, name: row.category_name, color: row.category_color } : null,
        description: hideClinical ? null : row.description,
        createdAt: row.created_at,
    };
}

/** Everything the public page needs for one share; slides limited to the share's scope. */
async function getShare(req, res) {
    const resolved = await loadActiveShare(req, res);
    if (!resolved) return;
    const { share, slides } = resolved;

    const meta = {
        type: share.resource_type,
        title: share.title,
        sharedBy: share.created_by_name || null,
        expiresAt: share.expires_at,
        showAnnotations: Boolean(share.show_annotations),
        allowAnnotationEdit: Boolean(share.allow_annotation_edit),
        hideClinical: Boolean(share.hide_clinical),
    };
    if (!isUnlocked(req, share)) {
        return res.status(401).json({ success: false, locked: true, share: meta, message: 'Link ini dilindungi password.' });
    }

    const token = share.token;
    const content = { slides: slides.map(slide => publicSlide(slide, token)) };
    if (share.resource_type === 'slide') {
        content.view = share.view_state || null;
    } else if (share.resource_type === 'compare') {
        content.compare = share.view_state;
    } else if (share.resource_type === 'cases') {
        // Keep the order in which the cases were picked; skip cases deleted since.
        const rows = await Promise.all((share.view_state?.cases || []).map(id => caseModel.findById(id)));
        content.cases = rows.filter(Boolean).map(row => publicCase(row, share.hide_clinical));
    } else if (share.resource_type === 'case') {
        const row = await caseModel.findById(share.resource_id);
        if (!row) return notFound(res, 'Case yang dibagikan sudah tidak ada.');
        content.case = publicCase(row, share.hide_clinical);
    } else if (share.resource_type === 'category') {
        const category = await categoryModel.findById(share.resource_id);
        if (!category) return notFound(res, 'Kategori yang dibagikan sudah tidak ada.');
        const cases = await caseModel.listCases({ categoryId: share.resource_id });
        content.category = { id: category.id, name: category.name, color: category.color, description: category.description };
        content.cases = cases.map(row => publicCase(row, share.hide_clinical));
    }

    shareModel.recordView(share.id).catch(error => log.warn('Failed to record share view', { error }));
    res.json({ share: meta, ...content });
}

async function unlockShare(req, res) {
    const resolved = await loadActiveShare(req, res);
    if (!resolved) return;
    const { share } = resolved;
    if (!share.has_password) return res.json({ success: true });

    const key = `${req.ip}|${share.token}`;
    const entry = failedUnlocks.get(key);
    if (entry && entry.resetAt > Date.now() && entry.count >= MAX_FAILED_ATTEMPTS) {
        return res.status(429).json({ success: false, message: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' });
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password || !await bcrypt.compare(password, share.password_hash)) {
        if (!entry || entry.resetAt < Date.now()) failedUnlocks.set(key, { count: 1, resetAt: Date.now() + LOCKOUT_MS });
        else entry.count += 1;
        log.warn(`Wrong password for share ${share.id}`, { ip: req.ip });
        return res.status(401).json({ success: false, message: 'Password salah.' });
    }

    failedUnlocks.delete(key);
    req.session.unlockedShares = [...new Set([...(req.session.unlockedShares || []), share.token])].slice(-50);
    res.json({ success: true });
}

async function getAnnotations(req, res) {
    const resolved = await loadActiveShare(req, res);
    if (!resolved) return;
    const { share, slideIds } = resolved;
    if (!isUnlocked(req, share)) return res.status(401).json({ success: false, locked: true, message: 'Link ini dilindungi password.' });

    const slideId = parseId(req.params.slideId);
    if (!slideId || !slideIds.has(slideId)) return notFound(res, 'Slide tidak termasuk dalam link ini.');
    if (!share.show_annotations) return res.json({ annotations: [], revision: 0 });
    res.json(await annotationService.getAnnotations(slideId));
}

/** Guests of a link with annotation access edit the slide's annotations under their own name. */
async function saveAnnotations(req, res) {
    const resolved = await loadActiveShare(req, res);
    if (!resolved) return;
    const { share, slideIds } = resolved;
    if (!isUnlocked(req, share)) return res.status(401).json({ success: false, locked: true, message: 'Link ini dilindungi password.' });
    if (!share.allow_annotation_edit) return res.status(403).json({ success: false, message: 'Link ini tidak mengizinkan perubahan anotasi.' });

    const slideId = parseId(req.params.slideId);
    if (!slideId || !slideIds.has(slideId)) return notFound(res, 'Slide tidak termasuk dalam link ini.');

    const authorName = typeof req.body?.authorName === 'string' ? req.body.authorName.trim() : '';
    if (!authorName || authorName.length > 100) return badRequest(res, 'Isi nama Anda (maksimal 100 karakter) sebelum menyimpan anotasi.');
    if (!annotationService.validateAnnotations(req.body?.annotations)) {
        return badRequest(res, 'Data anotasi tidak valid atau melebihi batas.');
    }
    if (!Number.isInteger(req.body.revision)) return badRequest(res, 'Revisi anotasi tidak valid. Muat ulang halaman.');

    try {
        const saved = await annotationService.saveAnnotations(slideId, req.body.annotations, req.body.revision, {
            name: authorName,
            type: 'guest',
        });
        log.info(`Guest saved annotations for slide ${slideId} via share ${share.id}`, {
            guest: authorName, count: saved.annotations.length, revision: saved.revision, ip: req.ip,
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

/**
 * Guards /share-tiles/:token/...: only DZI files and tiles of slides inside an active,
 * unlocked share are served. Everything after the token is relative to SLIDE_DIR.
 */
async function authorizeTiles(req, res, next) {
    try {
        const resolved = await resolveShare(req.params.token);
        if (resolved.state !== 'active' || !isUnlocked(req, resolved.share)) return res.status(404).send('Not found');

        const match = /^\/([^/]+?)(?:\.dzi|_files\/.+)$/.exec(req.path);
        let name = null;
        try {
            name = match && decodeURIComponent(match[1]);
        } catch {
            name = null;
        }
        if (!name || !resolved.storedNames.has(name)) return res.status(404).send('Not found');
        next();
    } catch (error) {
        next(error);
    }
}

function validateToken(req, res, next) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(req.params.token)) return badRequest(res, 'Link tidak valid.');
    next();
}

module.exports = {
    getShare,
    unlockShare,
    getAnnotations,
    saveAnnotations,
    authorizeTiles,
    validateToken,
};
