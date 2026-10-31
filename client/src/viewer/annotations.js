// Annotation drawing. Coordinates are stored in slide pixels, so they stay correct at every
// zoom level and rotation; toScreen() converts them to viewer-element pixels for the SVG layer.
import { t } from '../i18n';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const ANNOTATION_COLORS = [
    { value: '#16a34a', label: 'Hijau' },
    { value: '#2563eb', label: 'Biru' },
    { value: '#facc15', label: 'Kuning' },
    { value: '#dc2626', label: 'Merah' },
    { value: '#111827', label: 'Hitam' },
];

export const TOOLS = [
    { id: 'pan', icon: 'far fa-hand-paper', label: 'Geser', key: 'V' },
    { id: 'rect', icon: 'far fa-square', label: 'Persegi', key: 'R' },
    { id: 'circle', icon: 'far fa-circle', label: 'Elips', key: 'E' },
    { id: 'arrow', icon: 'fas fa-long-arrow-alt-right', label: 'Panah', key: 'A' },
    { id: 'freehand', icon: 'fas fa-pencil-alt', label: 'Gambar bebas', key: 'F' },
    { id: 'text', icon: 'fas fa-font', label: 'Teks', key: 'T' },
    { id: 'ruler', icon: 'fas fa-ruler', label: 'Penggaris', key: 'M' },
];

// Tools anyone may use; a ruler drawn without edit rights is a temporary measurement.
export const VIEW_TOOLS = TOOLS.filter(tool => tool.id === 'pan' || tool.id === 'ruler');

export const TOOL_KEYS = Object.fromEntries(TOOLS.map(tool => [tool.key.toLowerCase(), tool.id]));

export const TYPE_INFO = Object.fromEntries(TOOLS.filter(tool => tool.id !== 'pan').map(tool => [tool.id, tool]));

export function newAnnotationId() {
    return globalThis.crypto?.randomUUID?.() ?? `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Name shown in the list when the annotation has no label of its own. */
export function annotationTitle(annotation, index) {
    if (annotation.label) return annotation.label;
    if (annotation.type === 'text') return annotation.text;
    return `${t(TYPE_INFO[annotation.type]?.label || 'Anotasi')} ${index + 1}`;
}

/** Bounding box in slide pixels, padded so the shape is not glued to the screen edges. */
export function annotationBounds(annotation) {
    let xs;
    let ys;
    if (annotation.type === 'text') {
        xs = [annotation.x - 300, annotation.x + 600];
        ys = [annotation.y - 200, annotation.y + 200];
    } else if (Array.isArray(annotation.points)) {
        xs = annotation.points.map(point => point[0]);
        ys = annotation.points.map(point => point[1]);
    } else {
        xs = [annotation.x1, annotation.x2];
        ys = [annotation.y1, annotation.y2];
    }
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const width = Math.max(Math.max(...xs) - minX, 80);
    const height = Math.max(Math.max(...ys) - minY, 80);
    const pad = 0.6;
    return { x: minX - width * pad, y: minY - height * pad, width: width * (1 + 2 * pad), height: height * (1 + 2 * pad) };
}

export function createSvgLayer() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('annotation-layer');
    return svg;
}

function svgEl(name, attrs) {
    const el = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    return el;
}

// Same font as .ann-measure in viewer.css, to size the label behind a ruler's length.
const LABEL_FONT = '700 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
let labelContext = null;

function measureLabelWidth(text) {
    labelContext ??= document.createElement('canvas').getContext('2d');
    labelContext.font = LABEL_FONT;
    return labelContext.measureText(text).width;
}

/** Black or white, whichever reads better on the given #rrggbb background. */
function readableTextColor(hex) {
    const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.6 ? '#111827' : '#ffffff';
}

/** Length of a ruler in slide pixels. */
export function rulerLength(ann) {
    return Math.hypot(ann.x2 - ann.x1, ann.y2 - ann.y1);
}

/**
 * `measure(ann)` returns the label of a ruler (its length in µm or mm); the length is
 * worked out when drawing, so it follows the slide's current µm-per-pixel value.
 */
export function drawAnnotation(ann, toScreen, isDraft = false, isSelected = false, measure = null) {
    const common = {
        stroke: ann.color,
        'stroke-width': isSelected ? 4 : 2.5,
        fill: 'none',
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
        class: `ann${isDraft ? ' draft' : ''}${isSelected ? ' selected' : ''}`,
    };

    if (ann.type === 'text') {
        const p = toScreen(ann.x, ann.y);
        const text = svgEl('text', { x: p.x, y: p.y, fill: ann.color, class: `ann-text${isSelected ? ' selected' : ''}` });
        text.textContent = ann.text;
        return text;
    }

    if (ann.type === 'freehand' && Array.isArray(ann.points)) {
        const points = ann.points.map(([x, y]) => toScreen(x, y)).map(p => `${p.x},${p.y}`).join(' ');
        return svgEl('polyline', { ...common, points });
    }

    const a = toScreen(ann.x1, ann.y1);
    const b = toScreen(ann.x2, ann.y2);

    if (ann.type === 'rect') {
        // Transform all four corners so rectangles stay correct when the slide is rotated.
        const c = toScreen(ann.x2, ann.y1);
        const d = toScreen(ann.x1, ann.y2);
        return svgEl('polygon', { ...common, points: `${a.x},${a.y} ${c.x},${c.y} ${b.x},${b.y} ${d.x},${d.y}` });
    }

    if (ann.type === 'circle') {
        return svgEl('ellipse', {
            ...common,
            cx: (a.x + b.x) / 2,
            cy: (a.y + b.y) / 2,
            rx: Math.abs(b.x - a.x) / 2,
            ry: Math.abs(b.y - a.y) / 2,
        });
    }

    if (ann.type === 'arrow') {
        const group = svgEl('g', {});
        group.appendChild(svgEl('line', { ...common, x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const head = 14;
        const left = { x: b.x - head * Math.cos(angle - Math.PI / 7), y: b.y - head * Math.sin(angle - Math.PI / 7) };
        const right = { x: b.x - head * Math.cos(angle + Math.PI / 7), y: b.y - head * Math.sin(angle + Math.PI / 7) };
        group.appendChild(svgEl('polygon', {
            ...common,
            fill: ann.color,
            points: `${b.x},${b.y} ${left.x},${left.y} ${right.x},${right.y}`,
        }));
        return group;
    }

    if (ann.type === 'ruler') {
        // No shadow or halo: a plain line, and the length on a solid label.
        const line = { ...common, 'stroke-width': isSelected ? 3 : 2, class: `ann-ruler${isDraft ? ' draft' : ''}` };
        const group = svgEl('g', {});
        group.appendChild(svgEl('line', { ...line, x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
        // End ticks perpendicular to the line, a fixed size on screen.
        const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / length;
        const ny = (b.x - a.x) / length;
        const tick = 7;
        for (const end of [a, b]) {
            group.appendChild(svgEl('line', {
                ...line, x1: end.x - nx * tick, y1: end.y - ny * tick, x2: end.x + nx * tick, y2: end.y + ny * tick,
            }));
        }
        if (measure) {
            // Above the middle of the line (on the upper side whatever the drawing direction).
            const side = ny > 0 ? -1 : 1;
            const cx = (a.x + b.x) / 2 + nx * 16 * side;
            const cy = (a.y + b.y) / 2 + ny * 16 * side;
            const text = measure(ann);
            const width = measureLabelWidth(text) + 12;
            const height = 18;
            group.appendChild(svgEl('rect', {
                x: cx - width / 2, y: cy - height / 2, width, height, rx: 4,
                fill: ann.color, class: `ann-measure-bg${isSelected ? ' selected' : ''}`,
            }));
            const label = svgEl('text', { x: cx, y: cy, fill: readableTextColor(ann.color), class: 'ann-measure' });
            label.textContent = text;
            group.appendChild(label);
        }
        return group;
    }

    // Older freehand annotations only stored their start and end point.
    return svgEl('line', { ...common, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
}
