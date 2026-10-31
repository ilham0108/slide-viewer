import { getLocale } from '../i18n';

export const DEFAULT_SCANNER_MAG = 40;
export const MAG_PRESETS = [1, 2, 5, 10, 20, 40, 80];

export function scannerMagOf(slide) {
    return slide?.magnification || DEFAULT_SCANNER_MAG;
}

/** True when the slide's µm per pixel comes from its file rather than an estimate. */
export function hasMeasuredMpp(slide) {
    return slide?.mpp > 0;
}

// Micrometres per slide pixel: the value stored in the slide file when known. Otherwise
// 10 / objective is the usual approximation (0.25 µm/px at 40×, 0.5 µm/px at 20×).
export function micronsPerPixelOf(slide) {
    return hasMeasuredMpp(slide) ? slide.mpp : 10 / scannerMagOf(slide);
}

/** Resolution for the viewer's info line, e.g. "0.2452 µm/px" or "≈ 0.25 µm/px". */
export function formatMpp(slide) {
    const value = micronsPerPixelOf(slide).toLocaleString(getLocale(), { maximumFractionDigits: 4 });
    return `${hasMeasuredMpp(slide) ? '' : '≈ '}${value} µm/px`;
}

/** A length in micrometres as "85.3 µm" or "1.25 mm"; "≈" marks an estimated scale. */
export function formatLength(microns, estimated = false) {
    const prefix = estimated ? '≈ ' : '';
    if (microns >= 1000) {
        return `${prefix}${(microns / 1000).toLocaleString(getLocale(), { maximumFractionDigits: 2 })} mm`;
    }
    return `${prefix}${microns.toLocaleString(getLocale(), { maximumFractionDigits: microns < 100 ? 1 : 0 })} µm`;
}

export function tiledImage(viewer) {
    return viewer?.world.getItemCount() ? viewer.world.getItemAt(0) : null;
}

// Screen pixels per slide pixel × scanner objective = magnification the user is looking at.
export function currentMagnification(viewer, scannerMag) {
    const item = tiledImage(viewer);
    if (!item) return 0;
    return item.viewportToImageZoom(viewer.viewport.getZoom(true)) * scannerMag;
}

/** Current position for sharing: centre in slide pixels, magnification and rotation. */
export function getViewState(viewer, scannerMag) {
    const item = tiledImage(viewer);
    if (!item) return null;
    const center = item.viewportToImageCoordinates(viewer.viewport.getCenter(true));
    return {
        x: Math.round(center.x),
        y: Math.round(center.y),
        mag: Math.round(currentMagnification(viewer, scannerMag) * 100) / 100,
        rotation: viewer.viewport.getRotation(true),
    };
}

/** Restores a position saved by getViewState. */
export function applyViewState(viewer, scannerMag, view) {
    const item = tiledImage(viewer);
    if (!item || !view) return;
    viewer.viewport.setRotation(view.rotation || 0, true);
    viewer.viewport.zoomTo(item.imageToViewportZoom(view.mag / scannerMag), null, true);
    viewer.viewport.panTo(item.imageToViewportCoordinates(view.x, view.y), true);
}

export function zoomToMagnification(viewer, scannerMag, mag, immediately = false) {
    const item = tiledImage(viewer);
    if (!item) return;
    viewer.viewport.zoomTo(item.imageToViewportZoom(mag / scannerMag), null, immediately);
}
