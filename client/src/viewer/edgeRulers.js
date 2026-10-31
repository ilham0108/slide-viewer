// Rulers along the top and left edge of the viewer, in micrometres of the slide. Drawn on
// canvases on every viewport update, so they follow panning and zooming.
import OpenSeadragon from 'openseadragon';
import { getLocale } from '../i18n';
import { tiledImage } from './magnification';

// Must match the ruler thickness in viewer.css.
export const EDGE_RULER_SIZE = 22;
const MIN_MAJOR_SPACING_PX = 70;

/** Major tick step (µm) of at least MIN_MAJOR_SPACING_PX on screen: 1, 2, 2.5 or 5 × 10^n. */
function majorStep(micronsPerScreenPx) {
    const target = micronsPerScreenPx * MIN_MAJOR_SPACING_PX;
    const magnitude = 10 ** Math.floor(Math.log10(target));
    return [1, 2, 2.5, 5, 10].find(step => step * magnitude >= target) * magnitude;
}

/**
 * Sizes the drawing buffer for the screen's pixel ratio and returns a context in CSS
 * pixels. The size is the area inside the border (the CSS fixes the element's size).
 */
function prepare(canvas) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
    }
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    return { context, width, height };
}

/**
 * Draws one ruler. `start` is the value (µm) at the ruler's first pixel; `vertical` turns
 * it into the left ruler with its labels rotated.
 */
function drawRuler(canvas, { start, micronsPerScreenPx, step, cursor, vertical, colors }) {
    const { context, width, height } = prepare(canvas);
    const length = vertical ? height : width;
    const thickness = vertical ? width : height;
    // Minor ticks: 5 per major step, 4 when the step is a 2 (so they land on round values).
    const leading = step / 10 ** Math.floor(Math.log10(step));
    const minor = step / (Math.abs(leading - 2) < 1e-9 ? 4 : 5);

    context.strokeStyle = colors.tick;
    context.fillStyle = colors.text;
    context.font = '400 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    context.lineWidth = 1;
    context.beginPath();
    const first = Math.ceil(start / minor);
    const last = Math.floor((start + length * micronsPerScreenPx) / minor);
    for (let index = first; index <= last; index += 1) {
        const value = index * minor;
        const position = Math.round((value - start) / micronsPerScreenPx) + 0.5;
        const ratio = value / step;
        const isMajor = Math.abs(ratio - Math.round(ratio)) < 1e-6;
        const isHalf = !isMajor && Math.abs(ratio * 2 - Math.round(ratio * 2)) < 1e-6;
        const tick = isMajor ? thickness : isHalf ? 7 : 4;
        if (vertical) {
            context.moveTo(thickness - tick, position);
            context.lineTo(thickness, position);
        } else {
            context.moveTo(position, thickness - tick);
            context.lineTo(position, thickness);
        }
        // Values left of / above the slide's corner would be negative; leave them unlabelled.
        if (isMajor && value >= 0) {
            // Always micrometres, without thousands separators ("1662.5", "4075").
            const label = value.toLocaleString(getLocale(), { maximumFractionDigits: 2, useGrouping: false });
            if (vertical) {
                context.save();
                context.translate(10, position + 3);
                context.rotate(-Math.PI / 2);
                context.textAlign = 'right';
                context.fillText(label, 0, 0);
                context.restore();
            } else {
                context.textAlign = 'left';
                context.fillText(label, position + 3, 10);
            }
        }
    }
    context.stroke();

    if (cursor !== null && cursor >= 0 && cursor <= length) {
        context.strokeStyle = colors.cursor;
        context.lineWidth = 1.5;
        context.beginPath();
        if (vertical) {
            context.moveTo(0, cursor);
            context.lineTo(thickness, cursor);
        } else {
            context.moveTo(cursor, 0);
            context.lineTo(cursor, thickness);
        }
        context.stroke();
    }
}

/**
 * Redraws both rulers and the unit in the corner. Without rotation the rulers show slide
 * coordinates (0 at the slide's top-left corner); when the slide is rotated the screen axes
 * no longer follow the slide's, so they show the distance from the viewer edge instead.
 *
 * cursor: mouse position in viewer-element pixels, or null.
 */
export function drawEdgeRulers({ top, left, corner }, viewer, { micronsPerPixel, estimated, cursor }) {
    const item = tiledImage(viewer);
    if (!top || !left || !item) return;

    const screenPxPerSlidePx = item.viewportToImageZoom(viewer.viewport.getZoom(true));
    const micronsPerScreenPx = micronsPerPixel / screenPxPerSlidePx;
    const step = majorStep(micronsPerScreenPx);

    let startX = 0;
    let startY = 0;
    if (viewer.viewport.getRotation(true) % 360 === 0 && !viewer.viewport.getFlip()) {
        // The rulers begin after the corner square, EDGE_RULER_SIZE pixels into the viewer.
        const origin = viewer.viewport.viewerElementToImageCoordinates(new OpenSeadragon.Point(EDGE_RULER_SIZE, EDGE_RULER_SIZE));
        startX = origin.x * micronsPerPixel;
        startY = origin.y * micronsPerPixel;
    }

    const style = getComputedStyle(top);
    const colors = {
        text: style.color,
        tick: style.getPropertyValue('--edge-ruler-tick').trim() || style.color,
        cursor: style.getPropertyValue('--ui-accent').trim() || '#2563eb',
    };
    const common = { micronsPerScreenPx, step, colors };
    drawRuler(top, { ...common, start: startX, cursor: cursor ? cursor.x - EDGE_RULER_SIZE : null, vertical: false });
    drawRuler(left, { ...common, start: startY, cursor: cursor ? cursor.y - EDGE_RULER_SIZE : null, vertical: true });
    if (corner) corner.textContent = `${estimated ? '≈' : ''}µm`;
}
