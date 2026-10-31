const categoryModel = require('../models/categoryModel');
const slideModel = require('../models/slideModel');
const { parseId, cleanString, badRequest, notFound, conflict, isDuplicateKey } = require('../utils/validation');
const logger = require('../utils/logger');

const log = logger.child('categories');
const COLOR_PATTERN = /^#[\da-f]{6}$/i;

function serialize(row) {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        color: row.color,
        caseCount: row.case_count,
    };
}

function readCategoryInput(req, res) {
    const name = cleanString(req.body?.name, 100);
    const description = cleanString(req.body?.description, 255);
    const color = req.body?.color || '#2563eb';
    if (!name) return badRequest(res, 'Nama kategori wajib diisi (maksimal 100 karakter).');
    if (description === null) return badRequest(res, 'Deskripsi maksimal 255 karakter.');
    if (!COLOR_PATTERN.test(color)) return badRequest(res, 'Warna tidak valid.');
    return { name, description: description || null, color: color.toLowerCase() };
}

async function findCategory(id) {
    return (await categoryModel.listCategories()).find(category => category.id === id);
}

async function listCategories(req, res) {
    // The sidebar also shows how many slides are ready to view.
    const [categories, uncategorizedCaseCount, slideCount] = await Promise.all([
        categoryModel.listCategories(),
        categoryModel.countUncategorizedCases(),
        slideModel.countReadySlides(),
    ]);
    res.json({ categories: categories.map(serialize), uncategorizedCaseCount, slideCount });
}

async function createCategory(req, res) {
    const input = readCategoryInput(req, res);
    if (!input) return;
    try {
        const id = await categoryModel.createCategory(input);
        log.info(`Category created: ${input.name}`, { by: req.user.username });
        res.status(201).json({ category: serialize(await findCategory(id)) });
    } catch (error) {
        if (isDuplicateKey(error)) return conflict(res, 'Nama kategori sudah digunakan.');
        throw error;
    }
}

async function updateCategory(req, res) {
    const id = parseId(req.params.categoryId);
    if (!id) return badRequest(res, 'ID kategori tidak valid.');
    if (!await categoryModel.findById(id)) return notFound(res, 'Kategori tidak ditemukan.');
    const input = readCategoryInput(req, res);
    if (!input) return;
    try {
        await categoryModel.updateCategory(id, input);
    } catch (error) {
        if (isDuplicateKey(error)) return conflict(res, 'Nama kategori sudah digunakan.');
        throw error;
    }
    log.info(`Category updated: ${input.name}`, { by: req.user.username });
    res.json({ category: serialize(await findCategory(id)) });
}

async function deleteCategory(req, res) {
    const id = parseId(req.params.categoryId);
    if (!id) return badRequest(res, 'ID kategori tidak valid.');
    const existing = await categoryModel.findById(id);
    if (!existing) return notFound(res, 'Kategori tidak ditemukan.');
    const caseCount = await categoryModel.countCases(id);
    if (caseCount > 0) return conflict(res, `Kategori masih dipakai oleh ${caseCount} case.`);
    const slideCount = await categoryModel.countSlides(id);
    if (slideCount > 0) return conflict(res, `Kategori masih berisi ${slideCount} slide tanpa case. Pindahkan slide tersebut terlebih dahulu.`);

    await categoryModel.deleteCategory(id);
    log.info(`Category deleted: ${existing.name}`, { by: req.user.username });
    res.json({ success: true });
}

module.exports = {
    listCategories,
    createCategory,
    updateCategory,
    deleteCategory,
};
