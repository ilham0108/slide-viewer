const caseModel = require('../models/caseModel');
const categoryModel = require('../models/categoryModel');
const slideModel = require('../models/slideModel');
const { serializeSlide } = require('./slideController');
const { parseId, cleanString, readPage, badRequest, notFound, conflict, isDuplicateKey } = require('../utils/validation');
const logger = require('../utils/logger');

const log = logger.child('cases');
const CASE_STATUSES = new Set(['open', 'in_review', 'closed']);

function serialize(row) {
    return {
        id: row.id,
        caseNumber: row.case_number,
        title: row.title,
        status: row.status,
        description: row.description,
        category: row.category_id
            ? { id: row.category_id, name: row.category_name, color: row.category_color }
            : null,
        createdBy: row.created_by_name || null,
        slideCount: row.slide_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

async function readCaseInput(req, res) {
    const caseNumber = cleanString(req.body?.caseNumber, 64);
    const title = cleanString(req.body?.title, 255);
    const description = cleanString(req.body?.description, 5000);
    const status = req.body?.status || 'open';
    const categoryId = req.body?.categoryId ? parseId(req.body.categoryId) : null;

    if (!caseNumber) return badRequest(res, 'Nomor case wajib diisi (maksimal 64 karakter).');
    if (!title) return badRequest(res, 'Judul case wajib diisi (maksimal 255 karakter).');
    if (description === null) return badRequest(res, 'Deskripsi maksimal 5000 karakter.');
    if (!CASE_STATUSES.has(status)) return badRequest(res, 'Status case tidak valid.');
    if (req.body?.categoryId && (!categoryId || !await categoryModel.findById(categoryId))) {
        return badRequest(res, 'Kategori tidak ditemukan.');
    }
    return { caseNumber, title, description: description || null, status, categoryId };
}

async function listCases(req, res) {
    // "none" lists cases without a category.
    const categoryId = req.query.categoryId === 'none' ? 'none' : parseId(req.query.categoryId);
    const status = CASE_STATUSES.has(req.query.status) ? req.query.status : null;
    const search = cleanString(req.query.search, 100) || null;
    const filters = { search, categoryId, status };

    // ?page= asks for one page (the cases table); without it every case comes back (dropdowns).
    const paging = readPage(req.query, CASES_PAGE_SIZE);
    if (!paging) {
        const cases = await caseModel.listCases(filters);
        return res.json({ cases: cases.map(serialize) });
    }
    const [cases, total] = await Promise.all([
        caseModel.listCases({ ...filters, limit: paging.pageSize, offset: paging.offset }),
        caseModel.countCases(filters),
    ]);
    res.json({ cases: cases.map(serialize), total, page: paging.page, pageSize: paging.pageSize });
}

const CASES_PAGE_SIZE = 50;

async function getCase(req, res) {
    const id = parseId(req.params.caseId);
    if (!id) return badRequest(res, 'ID case tidak valid.');
    const row = await caseModel.findById(id);
    if (!row) return notFound(res, 'Case tidak ditemukan.');

    const slides = await slideModel.getSlidesForCase(id);
    res.json({
        case: { ...serialize(row), slideCount: slides.length },
        slides: slides.map(serializeSlide),
    });
}

async function createCase(req, res) {
    const input = await readCaseInput(req, res);
    if (!input) return;
    try {
        const id = await caseModel.createCase({ ...input, createdBy: req.user.id });
        log.info(`Case created: ${input.caseNumber}`, { id, by: req.user.username });
        res.status(201).json({ case: serialize({ ...await caseModel.findById(id), slide_count: 0 }) });
    } catch (error) {
        if (isDuplicateKey(error)) return conflict(res, 'Nomor case sudah digunakan.');
        throw error;
    }
}

async function updateCase(req, res) {
    const id = parseId(req.params.caseId);
    if (!id) return badRequest(res, 'ID case tidak valid.');
    if (!await caseModel.findById(id)) return notFound(res, 'Case tidak ditemukan.');
    const input = await readCaseInput(req, res);
    if (!input) return;
    try {
        await caseModel.updateCase(id, input);
    } catch (error) {
        if (isDuplicateKey(error)) return conflict(res, 'Nomor case sudah digunakan.');
        throw error;
    }
    log.info(`Case updated: ${input.caseNumber}`, { id, by: req.user.username });
    res.json({ case: serialize({ ...await caseModel.findById(id), slide_count: await caseModel.countSlides(id) }) });
}

async function deleteCase(req, res) {
    const id = parseId(req.params.caseId);
    if (!id) return badRequest(res, 'ID case tidak valid.');
    const existing = await caseModel.findById(id);
    if (!existing) return notFound(res, 'Case tidak ditemukan.');
    const slideCount = await caseModel.countSlides(id);
    if (slideCount > 0) {
        return conflict(res, `Case masih berisi ${slideCount} slide. Hapus atau pindahkan slide terlebih dahulu.`);
    }

    await caseModel.deleteCase(id);
    log.info(`Case deleted: ${existing.case_number}`, { id, by: req.user.username });
    res.json({ success: true });
}

/** Runs before multer so an upload to a missing case is rejected before the file is written. */
async function ensureCaseExists(req, res, next) {
    const id = parseId(req.params.caseId);
    if (!id) return badRequest(res, 'ID case tidak valid.');
    if (!await caseModel.findById(id)) return notFound(res, 'Case tidak ditemukan.');
    req.caseId = id;
    next();
}

module.exports = {
    listCases,
    getCase,
    createCase,
    updateCase,
    deleteCase,
    ensureCaseExists,
};
