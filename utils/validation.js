/** Parses a positive integer route/body id, or returns null. */
function parseId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Trims a string field; returns '' for missing values and null when it is too long or not a string. */
function cleanString(value, maxLength) {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length <= maxLength ? trimmed : null;
}

// The response helpers return null so input readers can `return badRequest(...)` and callers check `if (!input)`.
function badRequest(res, message) {
    res.status(400).json({ success: false, message });
    return null;
}

function notFound(res, message) {
    res.status(404).json({ success: false, message });
    return null;
}

function conflict(res, message) {
    res.status(409).json({ success: false, message });
    return null;
}

function isDuplicateKey(error) {
    return error?.code === 'ER_DUP_ENTRY';
}

/**
 * Reads ?page= (1-based) for a paged list: { page, pageSize, offset }, or null when the
 * request asks for no page, so callers that need everything (dropdowns) still get it.
 */
function readPage(query, pageSize) {
    if (query.page === undefined) return null;
    const page = parseId(query.page) || 1;
    return { page, pageSize, offset: (page - 1) * pageSize };
}

module.exports = {
    parseId,
    cleanString,
    readPage,
    badRequest,
    notFound,
    conflict,
    isDuplicateKey,
};
