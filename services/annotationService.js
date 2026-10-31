const crypto = require('crypto');
const pool = require('../database/pool');

const MAX_ANNOTATIONS = 5000;
const MAX_POINTS = 5000;
const TYPES = new Set(['rect', 'circle', 'arrow', 'freehand', 'text', 'ruler']);
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

class AnnotationConflictError extends Error {
    constructor(revision) {
        super('Annotations were changed by someone else.');
        this.revision = revision;
    }
}

const isNumber = value => typeof value === 'number' && Number.isFinite(value);
const optionalString = (value, max) => value === undefined || value === null || (typeof value === 'string' && value.length <= max);

/** Shape checks for one annotation coming from a client. */
function isValidAnnotation(annotation) {
    if (!annotation || typeof annotation !== 'object' || Array.isArray(annotation)) return false;
    if (!TYPES.has(annotation.type) || !/^#[\da-f]{6}$/i.test(annotation.color || '')) return false;
    if (!optionalString(annotation.label, 200) || !optionalString(annotation.description, 2000)) return false;
    if (annotation.id !== undefined && !(typeof annotation.id === 'string' && ID_PATTERN.test(annotation.id))) return false;
    if (annotation.type === 'text') {
        return isNumber(annotation.x) && isNumber(annotation.y)
            && typeof annotation.text === 'string' && annotation.text.length <= 1000;
    }
    // Freehand stores its path as [[x, y], ...]; older entries only have x1..y2.
    if (annotation.type === 'freehand' && annotation.points !== undefined) {
        return Array.isArray(annotation.points)
            && annotation.points.length >= 2
            && annotation.points.length <= MAX_POINTS
            && annotation.points.every(point => Array.isArray(point) && point.length === 2 && isNumber(point[0]) && isNumber(point[1]));
    }
    return ['x1', 'y1', 'x2', 'y2'].every(coordinate => isNumber(annotation[coordinate]));
}

function validateAnnotations(list) {
    return Array.isArray(list) && list.length <= MAX_ANNOTATIONS && list.every(isValidAnnotation);
}

/** Geometry and style only; everything else is rebuilt by the server. */
function geometryOf(annotation) {
    const keys = annotation.type === 'text' ? ['x', 'y', 'text']
        : annotation.type === 'freehand' && annotation.points ? ['points']
            : ['x1', 'y1', 'x2', 'y2'];
    return Object.fromEntries([['type', annotation.type], ['color', annotation.color], ...keys.map(key => [key, annotation[key]])]);
}

/**
 * Annotations saved before ids existed get stable ids from their position, so the first
 * save after the upgrade recognises them (and does not credit them to whoever saves).
 */
function withIds(annotations) {
    return annotations.map((annotation, index) => (annotation.id ? annotation : { ...annotation, id: `legacy-${index}`, author: null }));
}

/**
 * Merges what a client sent with what is stored: geometry, label and description come from
 * the client; id, author and creation time are kept for existing annotations and stamped by
 * the server for new ones, so an author cannot be forged.
 */
function normalize(incoming, existing, author) {
    const now = new Date().toISOString();
    const previous = new Map(existing.map(annotation => [annotation.id, annotation]));
    const seen = new Set();

    return incoming.map(annotation => {
        let id = typeof annotation.id === 'string' && ID_PATTERN.test(annotation.id) ? annotation.id : null;
        if (!id || seen.has(id)) id = crypto.randomUUID();
        seen.add(id);

        const prev = previous.get(id);
        const geometry = geometryOf(annotation);
        const label = (annotation.label || '').trim() || null;
        const description = (annotation.description || '').trim() || null;
        const changed = !prev
            || JSON.stringify(geometryOf(prev)) !== JSON.stringify(geometry)
            || (prev.label || null) !== label
            || (prev.description || null) !== description;

        return {
            id,
            ...geometry,
            label,
            description,
            author: prev ? prev.author ?? null : author.name,
            authorType: prev ? prev.authorType ?? null : author.type,
            createdAt: prev ? prev.createdAt ?? null : now,
            updatedAt: changed ? now : prev.updatedAt ?? null,
            updatedBy: changed ? author.name : prev.updatedBy ?? null,
        };
    });
}

function parseStored(value) {
    if (!value) return [];
    return typeof value === 'string' ? JSON.parse(value) : value;
}

async function getAnnotations(slideId) {
    const [rows] = await pool.execute('SELECT annotations, revision FROM slide_annotations WHERE slide_id = ? LIMIT 1', [slideId]);
    if (!rows[0]) return { annotations: [], revision: 0 };
    return { annotations: withIds(parseStored(rows[0].annotations)), revision: rows[0].revision };
}

/**
 * Replaces the annotations of a slide when `revision` still matches the stored one;
 * otherwise throws AnnotationConflictError (someone else saved in between).
 */
async function saveAnnotations(slideId, incoming, revision, author) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(
            'SELECT annotations, revision FROM slide_annotations WHERE slide_id = ? FOR UPDATE',
            [slideId]
        );
        const currentRevision = rows[0]?.revision ?? 0;
        if (revision !== currentRevision) throw new AnnotationConflictError(currentRevision);

        const existing = withIds(parseStored(rows[0]?.annotations));
        const annotations = normalize(incoming, existing, author);
        const nextRevision = currentRevision + 1;
        await connection.execute(
            `INSERT INTO slide_annotations (slide_id, annotations, revision) VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE annotations = VALUES(annotations), revision = VALUES(revision)`,
            [slideId, JSON.stringify(annotations), nextRevision]
        );
        await connection.commit();
        return { annotations, revision: nextRevision };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

module.exports = {
    AnnotationConflictError,
    validateAnnotations,
    getAnnotations,
    saveAnnotations,
};
