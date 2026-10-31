const fs = require('fs/promises');
const path = require('path');
const { SLIDE_DIR, UPLOAD_DIR } = require('../config/paths');
const pool = require('../database/pool');

// A slide's category is its case's category; a slide in no case may have its own.
const SLIDE_COLUMNS = `
    s.id, s.stored_name, s.original_name, s.status, s.progress, s.magnification, s.mpp, s.created_at,
    s.case_id, cs.case_number, cs.title AS case_title,
    cat.id AS category_id, cat.name AS category_name, cat.color AS category_color
`;
const SLIDE_JOINS = `
    FROM slides s
    LEFT JOIN cases cs ON cs.id = s.case_id
    LEFT JOIN categories cat ON cat.id = IF(s.case_id IS NULL, s.category_id, cs.category_id)
`;

/**
 * Ready slides, filtered by:
 *   caseId                  one case
 *   categoryId              a category: its cases' slides plus slides placed in it directly
 *                           ("none" = slides of cases without a category)
 *   categoryId + unassigned only the slides placed in that category directly
 *   unassigned              slides with neither a case nor a category
 *   search                  slide name, case number or case title
 * With `limit` only that page is returned; countAvailableSlides gives the total.
 */
async function getAvailableSlides({ caseId, unassigned, categoryId, search, limit, offset = 0 } = {}) {
    const { where, params } = availableSlidesFilter({ caseId, unassigned, categoryId, search });
    const paging = limit ? 'LIMIT ? OFFSET ?' : '';
    const [rows] = await pool.query(
        `SELECT ${SLIDE_COLUMNS} ${SLIDE_JOINS}
        WHERE ${where}
        ORDER BY s.created_at DESC, s.id DESC
        ${paging}`,
        limit ? [...params, limit, offset] : params
    );
    return rows;
}

async function countAvailableSlides(filters = {}) {
    const { where, params } = availableSlidesFilter(filters);
    const [[row]] = await pool.query(`SELECT COUNT(*) AS total ${SLIDE_JOINS} WHERE ${where}`, params);
    return Number(row.total);
}

function availableSlidesFilter({ caseId, unassigned, categoryId, search }) {
    const conditions = ["s.status = 'ready'"];
    const params = [];
    if (search) {
        const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
        conditions.push('(s.original_name LIKE ? OR cs.case_number LIKE ? OR cs.title LIKE ?)');
        params.push(like, like, like);
    }
    if (caseId) {
        conditions.push('s.case_id = ?');
        params.push(caseId);
    } else if (categoryId && categoryId !== 'none' && unassigned) {
        conditions.push('s.case_id IS NULL AND s.category_id = ?');
        params.push(categoryId);
    } else if (unassigned) {
        conditions.push('s.case_id IS NULL AND s.category_id IS NULL');
    } else if (categoryId === 'none') {
        conditions.push('s.case_id IS NOT NULL AND cs.category_id IS NULL');
    } else if (categoryId) {
        conditions.push('(cs.category_id = ? OR (s.case_id IS NULL AND s.category_id = ?))');
        params.push(categoryId, categoryId);
    }
    return { where: conditions.join(' AND '), params };
}

async function countReadySlides() {
    const [[row]] = await pool.query("SELECT COUNT(*) AS total FROM slides WHERE status = 'ready'");
    return row.total;
}

/** Ready-slide counts for the sidebar tree: overall, unsorted, per case, and per category (direct). */
async function getSlideCounts() {
    const [[totals]] = await pool.query(`
        SELECT COUNT(*) AS total, SUM(case_id IS NULL AND category_id IS NULL) AS unassigned
        FROM slides WHERE status = 'ready'
    `);
    const [perCategory] = await pool.query(`
        SELECT category_id, COUNT(*) AS total FROM slides
        WHERE status = 'ready' AND case_id IS NULL AND category_id IS NOT NULL
        GROUP BY category_id
    `);
    const [perCase] = await pool.query(`
        SELECT case_id, COUNT(*) AS total FROM slides
        WHERE status = 'ready' AND case_id IS NOT NULL
        GROUP BY case_id
    `);
    return {
        total: Number(totals.total),
        unassigned: Number(totals.unassigned || 0),
        byCase: new Map(perCase.map(row => [row.case_id, Number(row.total)])),
        byCategory: new Map(perCategory.map(row => [row.category_id, Number(row.total)])),
    };
}

/** Every slide of a case, including ones still converting or failed, for the case page. */
async function getSlidesForCase(caseId) {
    const [rows] = await pool.execute(
        `SELECT ${SLIDE_COLUMNS} ${SLIDE_JOINS}
        WHERE s.case_id = ?
        ORDER BY s.created_at DESC, s.id DESC`,
        [caseId]
    );
    return rows;
}

async function getSlideDetail(id) {
    const [rows] = await pool.execute(
        `SELECT ${SLIDE_COLUMNS}, s.source_name, s.category_id AS direct_category_id ${SLIDE_JOINS} WHERE s.id = ? LIMIT 1`,
        [id]
    );
    return rows[0] || null;
}

/**
 * The tile service finds a slide's source file by this name (the file name without its
 * extension), and the viewer requests "/slides/<name>.dzi".
 */
function getUploadPaths(uploadedFile) {
    const slideName = path.basename(uploadedFile.filename, path.extname(uploadedFile.filename));
    return {
        slideName,
        storedName: `${slideName}.dzi`,
        sourcePath: uploadedFile.path,
    };
}

function getSlideName(slide) {
    return path.basename(slide.stored_name, '.dzi');
}

function getSourcePath(slide) {
    return path.join(UPLOAD_DIR, slide.source_name);
}

/** A slide goes into a case, or (caseId null) straight into a category. */
async function createSlide({
    storedName, originalName, sourceName, caseId = null, categoryId = null, uploadedBy,
    status = 'processing', magnification = null, mpp = null, errorMessage = null,
}) {
    const [result] = await pool.execute(
        `INSERT INTO slides (stored_name, original_name, source_name, status, progress, magnification, mpp, error_message, case_id, category_id, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [storedName, originalName, sourceName, status, status === 'ready' ? 100 : 0, magnification, mpp, errorMessage,
            caseId, caseId ? null : categoryId, uploadedBy]
    );
    return result.insertId;
}

/**
 * Every slide whatever its status, newest first, for the uploads table. `search` matches the
 * slide name, case number/title and category name.
 */
async function listAllSlides({ search, limit, offset }) {
    const conditions = [];
    const params = [];
    if (search) {
        conditions.push('(s.original_name LIKE ? OR cs.case_number LIKE ? OR cs.title LIKE ? OR cat.name LIKE ?)');
        const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
        params.push(like, like, like, like);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${SLIDE_JOINS} ${where}`, params);
    const [rows] = await pool.query(
        `SELECT ${SLIDE_COLUMNS}, s.source_name, s.error_message, u.name AS uploaded_by_name, u.username AS uploaded_by_username
        ${SLIDE_JOINS}
        LEFT JOIN users u ON u.id = s.uploaded_by
        ${where}
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );
    return { total: Number(total), rows };
}

async function getSlideStatus(id) {
    const [rows] = await pool.execute(
        'SELECT id, stored_name, status, progress, magnification FROM slides WHERE id = ? LIMIT 1',
        [id]
    );
    return rows[0] || null;
}

async function getProcessingSlides() {
    const [rows] = await pool.execute(
        "SELECT id, stored_name, source_name FROM slides WHERE status = 'processing' AND source_name IS NOT NULL"
    );
    return rows;
}

async function markSlideReady(id, magnification, mpp = null) {
    await pool.execute(
        `UPDATE slides
        SET status = 'ready', progress = 100, magnification = ?, mpp = ?, error_message = NULL
        WHERE id = ?`,
        [magnification, mpp, id]
    );
}

/** Ready slides whose source file is kept but whose mpp was never read (uploaded earlier). */
async function getSlidesMissingMpp() {
    const [rows] = await pool.execute(
        "SELECT id, stored_name, source_name FROM slides WHERE status = 'ready' AND mpp IS NULL AND source_name IS NOT NULL"
    );
    return rows;
}

async function setSlideMpp(id, mpp) {
    await pool.execute('UPDATE slides SET mpp = ? WHERE id = ?', [mpp, id]);
}

async function markSlideFailed(id, errorMessage) {
    await pool.execute(
        `UPDATE slides
        SET status = 'failed', error_message = ?
        WHERE id = ?`,
        [errorMessage, id]
    );
}

async function importExistingSlides() {
    const files = (await fs.readdir(SLIDE_DIR)).filter(file => file.endsWith('.dzi'));
    // Skip slides that are already ready: every attempted INSERT, even one resolved by
    // ON DUPLICATE KEY, consumes an AUTO_INCREMENT value and makes slide IDs jump.
    const [readyRows] = await pool.query("SELECT stored_name FROM slides WHERE status = 'ready'");
    const readyNames = new Set(readyRows.map(row => row.stored_name));
    const unregistered = files.filter(file => !readyNames.has(file));
    for (const storedName of unregistered) {
        const originalName = path.basename(storedName, '.dzi');
        await pool.execute(
            `INSERT INTO slides (stored_name, original_name, status)
            VALUES (?, ?, 'ready')
            ON DUPLICATE KEY UPDATE
                status = IF(status = 'processing', 'ready', status)`,
            [storedName, originalName]
        );
    }
    return unregistered.length;
}

async function getSlideById(id) {
    const [rows] = await pool.execute(
        "SELECT id FROM slides WHERE id = ? AND status = 'ready' LIMIT 1",
        [id]
    );
    return rows[0] || null;
}

async function updateSlide(id, { caseId, categoryId, originalName }) {
    // In a case the case decides the category, so a separate one is not kept.
    await pool.execute(
        'UPDATE slides SET case_id = ?, category_id = ?, original_name = ? WHERE id = ?',
        [caseId, caseId ? null : categoryId, originalName, id]
    );
}

async function deleteSlide(id) {
    await pool.execute('DELETE FROM slides WHERE id = ?', [id]);
}

/** Removes a DZI and its tile folder made by the old vips conversion, if the slide has one. */
async function removeSlideOutput(slide) {
    const baseName = path.basename(slide.stored_name, '.dzi');
    await Promise.all([
        fs.rm(path.join(SLIDE_DIR, `${baseName}.dzi`), { force: true }),
        fs.rm(path.join(SLIDE_DIR, `${baseName}_files`), { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }),
    ]);
}

/** Removes the slide's source file and any DZI left from the old vips conversion. */
async function removeSlideFiles(slide) {
    await removeSlideOutput(slide);
    if (slide.source_name) await fs.rm(path.join(UPLOAD_DIR, slide.source_name), { force: true });
}

module.exports = {
    getAvailableSlides,
    countAvailableSlides,
    countReadySlides,
    getSlideCounts,
    getSlidesForCase,
    getSlideDetail,
    updateSlide,
    deleteSlide,
    removeSlideFiles,
    removeSlideOutput,
    getUploadPaths,
    getSlideName,
    getSourcePath,
    createSlide,
    listAllSlides,
    getSlideStatus,
    getProcessingSlides,
    markSlideReady,
    getSlidesMissingMpp,
    setSlideMpp,
    markSlideFailed,
    importExistingSlides,
    getSlideById,
};
