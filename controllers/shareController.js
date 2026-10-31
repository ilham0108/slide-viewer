const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const shareModel = require('../models/shareModel');
const slideModel = require('../models/slideModel');
const caseModel = require('../models/caseModel');
const categoryModel = require('../models/categoryModel');
const { clearShareCache } = require('../services/shareAccess');
const { parseId, cleanString, badRequest, notFound } = require('../utils/validation');
const logger = require('../utils/logger');

const log = logger.child('shares');
// slides / cases: a hand-picked selection, stored as ids in view_state.
const RESOURCE_TYPES = new Set(['slide', 'case', 'category', 'compare', 'slides', 'cases']);
const MAX_SELECTED_SLIDES = 100;
const MAX_SELECTED_CASES = 50;
const MAX_EXPIRY_DAYS = 365;

function serialize(row) {
    const now = Date.now();
    let status = 'active';
    if (row.revoked_at) status = 'revoked';
    else if (row.expires_at && new Date(row.expires_at).getTime() <= now) status = 'expired';
    return {
        id: row.id,
        url: `/s/${row.token}`,
        type: row.resource_type,
        resourceId: row.resource_id,
        title: row.title,
        targetName: row.target_name
            ?? (row.resource_type === 'slides' ? `${row.view_state?.slides?.length || 0} slide`
                : row.resource_type === 'cases' ? `${row.view_state?.cases?.length || 0} case` : null),
        hasPassword: Boolean(row.has_password),
        expiresAt: row.expires_at,
        hideClinical: Boolean(row.hide_clinical),
        showAnnotations: Boolean(row.show_annotations),
        allowAnnotationEdit: Boolean(row.allow_annotation_edit),
        hasViewState: Boolean(row.view_state),
        createdBy: row.created_by_name || null,
        createdById: row.created_by,
        createdAt: row.created_at,
        revokedAt: row.revoked_at,
        viewCount: row.view_count,
        lastViewedAt: row.last_viewed_at,
        status,
    };
}

const isNumber = value => typeof value === 'number' && Number.isFinite(value);

/** Distinct positive ids in their original order, or null when the list is invalid. */
function uniqueIds(values) {
    if (!Array.isArray(values)) return null;
    const ids = values.map(parseId);
    if (ids.some(id => !id)) return null;
    return [...new Set(ids)];
}

/** A viewer position: centre in slide pixels, magnification, rotation in degrees. */
function cleanView(view) {
    if (!view || typeof view !== 'object') return null;
    if (!isNumber(view.x) || !isNumber(view.y) || !isNumber(view.mag) || view.mag <= 0 || view.mag > 1000) return null;
    const rotation = isNumber(view.rotation) ? ((Math.round(view.rotation / 90) * 90) % 360 + 360) % 360 : 0;
    return { x: view.x, y: view.y, mag: view.mag, rotation };
}

/** Checks the shared target exists and builds the default title. Returns null after answering 4xx. */
async function resolveTarget(res, type, resourceId, rawViewState) {
    if (type === 'slide') {
        const slide = await slideModel.getSlideDetail(resourceId);
        if (!slide || slide.status !== 'ready') return notFound(res, 'Slide tidak ditemukan atau belum siap.');
        const view = rawViewState ? cleanView(rawViewState) : null;
        if (rawViewState && !view) return badRequest(res, 'Posisi tampilan tidak valid.');
        return { title: slide.original_name.replace(/\.(svs|tiff?)$/i, ''), viewState: view };
    }
    if (type === 'case') {
        const row = await caseModel.findById(resourceId);
        if (!row) return notFound(res, 'Case tidak ditemukan.');
        return { title: `${row.case_number} — ${row.title}`, viewState: null };
    }
    if (type === 'category') {
        const row = await categoryModel.findById(resourceId);
        if (!row) return notFound(res, 'Kategori tidak ditemukan.');
        return { title: row.name, viewState: null };
    }

    if (type === 'slides') {
        const ids = uniqueIds(rawViewState?.slides);
        if (!ids || !ids.length || ids.length > MAX_SELECTED_SLIDES) {
            return badRequest(res, `Pilih 1–${MAX_SELECTED_SLIDES} slide untuk dibagikan.`);
        }
        const slides = await Promise.all(ids.map(id => slideModel.getSlideDetail(id)));
        if (slides.some(slide => !slide || slide.status !== 'ready')) return notFound(res, 'Salah satu slide tidak ditemukan atau belum siap.');
        return { title: `${ids.length} slide pilihan`, viewState: { slides: ids } };
    }
    if (type === 'cases') {
        const ids = uniqueIds(rawViewState?.cases);
        if (!ids || !ids.length || ids.length > MAX_SELECTED_CASES) {
            return badRequest(res, `Pilih 1–${MAX_SELECTED_CASES} case untuk dibagikan.`);
        }
        const rows = await Promise.all(ids.map(id => caseModel.findById(id)));
        if (rows.some(row => !row)) return notFound(res, 'Salah satu case tidak ditemukan.');
        return { title: `${ids.length} case pilihan`, viewState: { cases: ids } };
    }

    // compare: { layout, slides: [ids], panels: [view|null], sync }
    const state = rawViewState || {};
    const slideIds = Array.isArray(state.slides) ? state.slides.map(parseId) : [];
    if (!slideIds.length || slideIds.length > 4 || slideIds.some(id => !id)) {
        return badRequest(res, 'Pilih 1–4 slide untuk dibagikan.');
    }
    const slides = await Promise.all(slideIds.map(id => slideModel.getSlideDetail(id)));
    if (slides.some(slide => !slide || slide.status !== 'ready')) return notFound(res, 'Salah satu slide tidak ditemukan atau belum siap.');
    const panels = slideIds.map((_, index) => cleanView(state.panels?.[index]));
    return {
        title: `Perbandingan ${slides.length} slide`,
        viewState: { layout: slideIds.length, slides: slideIds, panels, sync: Boolean(state.sync) },
    };
}

async function createShare(req, res) {
    const type = req.body?.type;
    if (!RESOURCE_TYPES.has(type)) return badRequest(res, 'Jenis berbagi tidak valid.');
    const isSelection = type === 'compare' || type === 'slides' || type === 'cases';
    const resourceId = isSelection ? null : parseId(req.body?.resourceId);
    if (!isSelection && !resourceId) return badRequest(res, 'Target berbagi tidak valid.');

    const customTitle = cleanString(req.body?.title, 255);
    if (customTitle === null) return badRequest(res, 'Judul maksimal 255 karakter.');
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password && (password.length < 4 || password.length > 128)) return badRequest(res, 'Password minimal 4 karakter.');

    let expiresAt = null;
    if (req.body?.expiresInDays !== undefined && req.body.expiresInDays !== null) {
        const days = Number(req.body.expiresInDays);
        if (!Number.isFinite(days) || days <= 0 || days > MAX_EXPIRY_DAYS) return badRequest(res, 'Masa berlaku tidak valid.');
        expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }

    const target = await resolveTarget(res, type, resourceId, req.body?.viewState);
    if (!target) return;

    const token = crypto.randomBytes(24).toString('base64url');
    const id = await shareModel.createShare({
        token,
        resourceType: type,
        resourceId,
        title: customTitle || target.title,
        viewState: target.viewState,
        passwordHash: password ? await bcrypt.hash(password, 10) : null,
        expiresAt,
        hideClinical: Boolean(req.body?.hideClinical),
        // Editing implies seeing the annotations.
        showAnnotations: req.body?.showAnnotations !== false || Boolean(req.body?.allowAnnotationEdit),
        allowAnnotationEdit: Boolean(req.body?.allowAnnotationEdit),
        createdBy: req.user.id,
    });
    log.info(`Share link created for ${type}${resourceId ? ` ${resourceId}` : ''}`, {
        id, by: req.user.username, password: Boolean(password), expiresAt, annotationEdit: Boolean(req.body?.allowAnnotationEdit),
    });
    res.status(201).json({ share: serialize(await shareModel.findById(id)) });
}

/** Own links; users with shares.manage may pass ?all=1 to see everyone's. */
async function listShares(req, res) {
    const all = req.query.all === '1' && req.user.permissions.has('shares.manage');
    const rows = await shareModel.listShares({ createdBy: all ? null : req.user.id });
    res.json({ shares: rows.map(serialize), canManageAll: req.user.permissions.has('shares.manage') });
}

async function revokeShare(req, res) {
    const id = parseId(req.params.shareId);
    if (!id) return badRequest(res, 'ID link tidak valid.');
    const share = await shareModel.findById(id);
    if (!share) return notFound(res, 'Link tidak ditemukan.');
    if (share.created_by !== req.user.id && !req.user.permissions.has('shares.manage')) {
        return res.status(403).json({ success: false, message: 'Anda hanya dapat mencabut link milik sendiri.' });
    }

    await shareModel.revokeShare(id);
    clearShareCache(share.token);
    log.info(`Share link ${id} revoked`, { by: req.user.username });
    res.json({ share: serialize(await shareModel.findById(id)) });
}

module.exports = {
    createShare,
    listShares,
    revokeShare,
};
