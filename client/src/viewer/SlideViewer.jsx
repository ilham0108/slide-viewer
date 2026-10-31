import { useCallback, useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import { api } from '../api';
import { useToast } from '../components/Toast';
import { displayName, formatMag, numberFormat } from '../utils/format';
import AnnotationPanel from './AnnotationPanel';
import MagnificationSlider from './MagnificationSlider';
import { drawEdgeRulers } from './edgeRulers';
import { t } from '../i18n';
import {
    ANNOTATION_COLORS,
    TOOLS,
    TOOL_KEYS,
    VIEW_TOOLS,
    annotationBounds,
    createSvgLayer,
    drawAnnotation,
    newAnnotationId,
    rulerLength,
} from './annotations';
import {
    MAG_PRESETS,
    applyViewState,
    currentMagnification,
    formatLength,
    hasMeasuredMpp,
    micronsPerPixelOf,
    scannerMagOf,
    tiledImage,
    zoomToMagnification,
} from './magnification';

const SCALE_BAR_TARGET_PX = 120;
const MAX_FREEHAND_POINTS = 5000; // matches the server-side validation limit
// Per browser: whether the rulers along the viewer edges are shown (on by default).
const EDGE_RULERS_KEY = 'viewer-edge-rulers';

function readStoredEdgeRulers() {
    try {
        return localStorage.getItem(EDGE_RULERS_KEY) !== '0';
    } catch {
        return true;
    }
}

/**
 * One OpenSeadragon viewer with magnification presets, scale bar, cursor position and an
 * SVG annotation layer with a list panel (click an item to fly to it). With `editable` it
 * also shows the drawing tools and saves to the API.
 * Used full-size on the viewer page and several times side by side on the compare page.
 *
 * Most viewer state lives in a ref (`stateRef`) because OpenSeadragon calls the handlers
 * dozens of times per second; only what the UI displays is kept in React state.
 */
export default function SlideViewer({
    slide,
    editable = false,
    showAnnotations = true,
    compact = false,
    keyboard = false,
    onReady,
    onOpen,
    onDirtyChange,
    // Where annotations are loaded from; null skips loading (e.g. a share without annotations).
    annotationsPath,
    // Where they are saved (PUT), and extra fields for that request (e.g. a guest's name).
    savePath,
    saveExtra,
    // Position to show once the slide opens, as saved by getViewState().
    initialView,
}) {
    const toast = useToast();
    const stageRef = useRef(null);
    const containerRef = useRef(null);
    const viewerRef = useRef(null);
    const scaleLineRef = useRef(null);
    const scaleLabelRef = useRef(null);
    const cursorRef = useRef(null);
    const rulerTopRef = useRef(null);
    const rulerLeftRef = useRef(null);
    const rulerCornerRef = useRef(null);
    const drawRulersRef = useRef(() => {});
    const stateRef = useRef({
        slide: null,
        scannerMag: scannerMagOf(slide),
        umPerPx: micronsPerPixelOf(slide),
        mppMeasured: hasMeasuredMpp(slide),
        isOpen: false,
        annotations: [],
        revision: 0,
        selectedId: null,
        draft: null,
        // A ruler drawn without edit rights: shown, never saved.
        measurement: null,
        // Mouse position in viewer pixels, marked on the edge rulers.
        cursor: null,
        tool: 'pan',
        color: ANNOTATION_COLORS[0].value,
        editable,
        showAnnotations,
    });
    const renderRef = useRef(() => {});
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    const onOpenRef = useRef(onOpen);
    onOpenRef.current = onOpen;
    const initialViewRef = useRef(initialView);
    initialViewRef.current = initialView;
    const textInputIdRef = useRef(0);

    const [status, setStatus] = useState('loading');
    const [magnification, setMagnification] = useState(0);
    // Magnification with the whole slide in view: the low end of the slider.
    const [minMagnification, setMinMagnification] = useState(0);
    const [tool, setToolState] = useState('pan');
    const [color, setColorState] = useState(ANNOTATION_COLORS[0].value);
    const [colorOpen, setColorOpen] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [textInput, setTextInput] = useState(null);
    const [list, setList] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    // The annotation list is opened on demand and takes room beside the slide.
    const [panelOpen, setPanelOpen] = useState(false);
    const [edgeRulers, setEdgeRulers] = useState(readStoredEdgeRulers);

    const scannerMag = scannerMagOf(slide);
    const annotationsUrl = slide ? (annotationsPath === undefined ? `/slides/${slide.id}/annotations` : annotationsPath) : null;
    const saveUrl = slide ? savePath || `/slides/${slide.id}/annotations` : null;

    const syncList = useCallback(() => setList([...stateRef.current.annotations]), []);

    const markChanged = useCallback(() => {
        setDirty(true);
        syncList();
        renderRef.current();
    }, [syncList]);

    const select = useCallback(id => {
        stateRef.current.selectedId = id;
        setSelectedId(id);
        renderRef.current();
    }, []);

    /** Adds a finished shape, names nothing yet, and opens it in the list for a name/description. */
    const addAnnotation = useCallback(annotation => {
        const entry = { ...annotation, id: newAnnotationId(), label: null, description: null };
        stateRef.current.annotations.push(entry);
        stateRef.current.selectedId = entry.id;
        setSelectedId(entry.id);
        markChanged();
    }, [markChanged]);

    // ------------------------------------------------------------------
    // Create the viewer once
    // ------------------------------------------------------------------
    useEffect(() => {
        const s = stateRef.current;
        const viewer = OpenSeadragon({
            element: containerRef.current,
            showNavigationControl: false,
            showNavigator: true,
            navigatorPosition: 'TOP_RIGHT',
            navigatorSizeRatio: compact ? 0.2 : 0.16,
            navigatorAutoFade: false,
            // Allow digital zoom up to 2 screen pixels per slide pixel (e.g. 80× for a 40× scan).
            maxZoomPixelRatio: 2,
            // Keep "fit" clear of the tool palette (left) and the magnification bar (bottom).
            viewportMargins: compact
                ? { left: 8, right: 8, top: 8, bottom: 48 }
                : { left: 64, right: 8, top: 8, bottom: 60 },
            visibilityRatio: 0.5,
            constrainDuringPan: true,
            gestureSettingsMouse: { scrollToZoom: true, clickToZoom: false, dblClickToZoom: true, flickEnabled: true },
            gestureSettingsTouch: { flickEnabled: true, pinchRotate: false },
            zoomPerScroll: 1.25,
            animationTime: 0.5,
            springStiffness: 7,
            immediateRender: false,
        });
        viewerRef.current = viewer;

        const svg = createSvgLayer();
        viewer.canvas.appendChild(svg);

        const toScreen = (x, y) => viewer.viewport.imageToViewerElementCoordinates(new OpenSeadragon.Point(x, y));
        const measure = ann => formatLength(rulerLength(ann) * s.umPerPx, !s.mppMeasured);
        const render = () => {
            svg.replaceChildren();
            if (!s.isOpen) return;
            if (s.showAnnotations) {
                for (const ann of s.annotations) svg.appendChild(drawAnnotation(ann, toScreen, false, ann.id === s.selectedId, measure));
            }
            if (s.measurement) svg.appendChild(drawAnnotation(s.measurement, toScreen, false, false, measure));
            if (s.draft) svg.appendChild(drawAnnotation(s.draft, toScreen, true, false, measure));
        };
        renderRef.current = render;

        const updateScaleBar = () => {
            const item = tiledImage(viewer);
            if (!item || !scaleLineRef.current) return;
            const screenPxPerSlidePx = item.viewportToImageZoom(viewer.viewport.getZoom(true));
            const micronsPerScreenPx = s.umPerPx / screenPxPerSlidePx;
            const target = micronsPerScreenPx * SCALE_BAR_TARGET_PX;
            const magnitude = 10 ** Math.floor(Math.log10(target));
            const nice = [1, 2, 5, 10].find(step => step * magnitude >= target * 0.75) * magnitude;
            scaleLineRef.current.style.width = `${nice / micronsPerScreenPx}px`;
            scaleLabelRef.current.textContent = formatLength(nice, !s.mppMeasured);
        };

        const drawRulers = () => {
            if (!s.isOpen) return;
            drawEdgeRulers(
                { top: rulerTopRef.current, left: rulerLeftRef.current, corner: rulerCornerRef.current },
                viewer,
                { micronsPerPixel: s.umPerPx, estimated: !s.mppMeasured, cursor: s.cursor },
            );
        };
        drawRulersRef.current = drawRulers;

        const updateMinMagnification = () => {
            const item = tiledImage(viewer);
            if (!item) return;
            setMinMagnification(item.viewportToImageZoom(viewer.viewport.getMinZoom()) * s.scannerMag);
        };

        viewer.addHandler('update-viewport', () => {
            setMagnification(Math.round(currentMagnification(viewer, s.scannerMag) * 100) / 100);
            updateScaleBar();
            drawRulers();
            render();
        });

        viewer.addHandler('canvas-exit', () => {
            if (cursorRef.current) cursorRef.current.textContent = '';
            s.cursor = null;
            drawRulers();
        });
        const cursorTracker = new OpenSeadragon.MouseTracker({
            element: viewer.canvas,
            moveHandler: event => {
                s.cursor = { x: event.position.x, y: event.position.y };
                drawRulers();
                const item = tiledImage(viewer);
                if (!item || !cursorRef.current) return;
                const point = viewer.viewport.viewerElementToImageCoordinates(event.position);
                const size = item.getContentSize();
                if (point.x < 0 || point.y < 0 || point.x > size.x || point.y > size.y) {
                    cursorRef.current.textContent = '';
                    return;
                }
                const um = s.umPerPx;
                cursorRef.current.textContent =
                    `X ${numberFormat.format(Math.round(point.x * um))} µm · Y ${numberFormat.format(Math.round(point.y * um))} µm`;
            },
        });

        viewer.addHandler('open', () => {
            s.isOpen = true;
            const size = tiledImage(viewer).getContentSize();
            if (initialViewRef.current) applyViewState(viewer, s.scannerMag, initialViewRef.current);
            onOpenRef.current?.({ width: size.x, height: size.y });
            setStatus('ready');
            updateMinMagnification();
            drawRulers();
            render();
        });
        // The viewer changes size with the window and when the annotation list opens.
        viewer.addHandler('resize', () => {
            updateMinMagnification();
            drawRulers();
        });
        viewer.addHandler('open-failed', event => {
            console.error('Failed to open slide:', event.message);
            setStatus('error');
        });

        // ---- Drawing -----------------------------------------------------
        // Use the viewer's own canvas events: a second MouseTracker on the canvas does not
        // receive presses while OpenSeadragon's tracker is active.
        const release = () => {
            if (!s.draft) return;
            const finished = s.draft;
            s.draft = null;
            const a = finished.type === 'freehand' ? null : toScreen(finished.x1, finished.y1);
            const b = finished.type === 'freehand' ? null : toScreen(finished.x2, finished.y2);
            const tooSmall = finished.type === 'freehand'
                ? finished.points.length < 2
                : Math.hypot(b.x - a.x, b.y - a.y) < 4;
            if (tooSmall) {
                render();
                return;
            }
            if (finished.type === 'ruler' && !s.editable) {
                s.measurement = finished;
                render();
                return;
            }
            addAnnotationRef.current(finished);
        };

        viewer.addHandler('canvas-press', event => {
            if (s.tool === 'pan' || !s.isOpen) return;
            if (!s.editable && s.tool !== 'ruler') return;
            // Text input opens on click (below), after OpenSeadragon has finished moving focus.
            if (s.tool === 'text') return;
            const point = viewer.viewport.viewerElementToImageCoordinates(event.position);
            s.draft = s.tool === 'freehand'
                ? { type: 'freehand', points: [[point.x, point.y]], color: s.color }
                : { type: s.tool, x1: point.x, y1: point.y, x2: point.x, y2: point.y, color: s.color };
        });
        viewer.addHandler('canvas-drag', event => {
            if (!s.draft) return;
            event.preventDefaultAction = true;
            const point = viewer.viewport.viewerElementToImageCoordinates(event.position);
            if (s.draft.type === 'freehand') {
                // Keep a point every ~2 screen pixels; enough detail without bloating the data.
                const last = s.draft.points[s.draft.points.length - 1];
                const lastScreen = toScreen(last[0], last[1]);
                if (Math.hypot(lastScreen.x - event.position.x, lastScreen.y - event.position.y) < 2) return;
                if (s.draft.points.length >= MAX_FREEHAND_POINTS) return;
                s.draft.points.push([point.x, point.y]);
            } else {
                s.draft.x2 = point.x;
                s.draft.y2 = point.y;
            }
            render();
        });
        viewer.addHandler('canvas-release', release);
        // A drag that leaves the canvas still ends the shape.
        viewer.addHandler('canvas-exit', event => { if (s.draft && !event.buttonDownAny) release(); });

        viewer.addHandler('canvas-click', event => {
            if (!s.editable || s.tool !== 'text' || !s.isOpen || !event.quick) return;
            event.preventDefaultAction = true;
            const point = viewer.viewport.viewerElementToImageCoordinates(event.position);
            const stageRect = stageRef.current.getBoundingClientRect();
            const canvasRect = viewer.canvas.getBoundingClientRect();
            const left = event.position.x + canvasRect.left - stageRect.left;
            const top = event.position.y + canvasRect.top - stageRect.top;
            textInputIdRef.current += 1;
            const id = textInputIdRef.current;
            requestAnimationFrame(() => setTextInput({ id, left, top, x: point.x, y: point.y }));
        });

        // OpenSeadragon's own keys (R rotates, F flips, W/A/S/D pan) clash with the tool
        // shortcuts, so its keyboard handling is turned off.
        viewer.addHandler('canvas-key', event => { event.preventDefaultAction = true; });

        onReadyRef.current?.(viewer);
        return () => {
            onReadyRef.current?.(null);
            cursorTracker.destroy();
            viewer.destroy();
            viewerRef.current = null;
        };
        // compact only changes the initial layout; the viewer is created once per mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // The OpenSeadragon handlers above are created once; they reach the latest callback here.
    const addAnnotationRef = useRef(addAnnotation);
    addAnnotationRef.current = addAnnotation;

    // ------------------------------------------------------------------
    // Open a slide and load its annotations
    // ------------------------------------------------------------------
    const loadAnnotations = useCallback((signal) => {
        const s = stateRef.current;
        const request = annotationsUrl ? api(annotationsUrl, { signal }) : Promise.resolve({ annotations: [], revision: 0 });
        return request.then(data => {
            s.annotations = Array.isArray(data.annotations) ? data.annotations : [];
            s.revision = Number.isInteger(data.revision) ? data.revision : 0;
            if (!s.annotations.some(annotation => annotation.id === s.selectedId)) {
                s.selectedId = null;
                setSelectedId(null);
            }
            setDirty(false);
            syncList();
            renderRef.current();
        });
    }, [annotationsUrl, syncList]);

    useEffect(() => {
        const viewer = viewerRef.current;
        const s = stateRef.current;
        if (!viewer) return undefined;
        if (!slide?.dzi) {
            // An emptied compare panel: drop the previous image and its annotations.
            viewer.close();
            Object.assign(s, { slide: null, isOpen: false, annotations: [], draft: null, measurement: null, selectedId: null, revision: 0 });
            setStatus('empty');
            setSelectedId(null);
            syncList();
            renderRef.current();
            return undefined;
        }

        Object.assign(s, {
            slide,
            scannerMag: scannerMagOf(slide),
            umPerPx: micronsPerPixelOf(slide),
            mppMeasured: hasMeasuredMpp(slide),
            isOpen: false,
            annotations: [],
            revision: 0,
            selectedId: null,
            draft: null,
            measurement: null,
        });
        setDirty(false);
        setSelectedId(null);
        syncList();
        setStatus('loading');
        setTextInput(null);
        renderRef.current();

        const controller = new AbortController();
        loadAnnotations(controller.signal).catch(error => {
            if (error.name === 'AbortError') return;
            console.error('Failed to load slide annotations:', error);
            toast('Anotasi untuk slide ini gagal dimuat.', 'error');
        });

        viewer.open(slide.dzi);
        return () => controller.abort();
        // Re-open only when a different slide is chosen.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slide?.id, slide?.dzi]);

    useEffect(() => {
        const s = stateRef.current;
        s.editable = editable;
        s.showAnnotations = showAnnotations;
        if (!editable && stateRef.current.tool !== 'ruler') applyTool('pan');
        renderRef.current();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editable, showAnnotations]);

    useEffect(() => {
        onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);

    // The ruler canvases mount with this render; draw them straight away.
    useEffect(() => {
        if (edgeRulers) drawRulersRef.current();
    }, [edgeRulers, status]);

    function toggleEdgeRulers() {
        setEdgeRulers(current => {
            try {
                localStorage.setItem(EDGE_RULERS_KEY, current ? '0' : '1');
            } catch {
                // The choice then lasts for this visit only.
            }
            return !current;
        });
    }

    // ------------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------------
    function applyTool(nextTool) {
        const viewer = viewerRef.current;
        const s = stateRef.current;
        setTextInput(null);
        s.tool = nextTool;
        setToolState(nextTool);
        if (!viewer) return;
        // While drawing, a drag draws instead of panning; scroll-to-zoom keeps working.
        const drawing = nextTool !== 'pan';
        for (const settings of [viewer.gestureSettingsMouse, viewer.gestureSettingsPen, viewer.gestureSettingsTouch]) {
            settings.dragToPan = !drawing;
            settings.flickEnabled = !drawing;
            settings.dblClickToZoom = !drawing && settings === viewer.gestureSettingsMouse;
        }
    }

    function applyColor(nextColor) {
        stateRef.current.color = nextColor;
        setColorState(nextColor);
    }

    /** Selects an annotation and flies the viewer to it. */
    function focusAnnotation(id) {
        const viewer = viewerRef.current;
        const annotation = stateRef.current.annotations.find(item => item.id === id);
        select(id);
        const item = tiledImage(viewer);
        if (!annotation || !item) return;
        const box = annotationBounds(annotation);
        viewer.viewport.fitBounds(item.imageToViewportRectangle(box.x, box.y, box.width, box.height));
    }

    function updateAnnotation(id, patch) {
        const annotation = stateRef.current.annotations.find(item => item.id === id);
        if (!annotation) return;
        Object.assign(annotation, patch);
        markChanged();
    }

    function deleteAnnotation(id) {
        const s = stateRef.current;
        s.annotations = s.annotations.filter(item => item.id !== id);
        if (s.selectedId === id) select(null);
        markChanged();
    }

    function undo() {
        const s = stateRef.current;
        if (!s.annotations.length) return;
        const removed = s.annotations.pop();
        if (removed.id === s.selectedId) select(null);
        markChanged();
    }

    function clearAll() {
        const s = stateRef.current;
        if (!s.annotations.length) return;
        if (!window.confirm(t('Hapus semua {n} anotasi pada slide ini?', { n: s.annotations.length }))) return;
        s.annotations = [];
        select(null);
        markChanged();
    }

    async function save() {
        const s = stateRef.current;
        if (!s.slide || saving) return;
        setSaving(true);
        try {
            const data = await api(saveUrl, {
                method: 'PUT',
                body: { annotations: s.annotations, revision: s.revision, ...saveExtra },
            });
            // The server stamps ids, authors and times; show exactly what was stored.
            s.annotations = data.annotations;
            s.revision = data.revision;
            setDirty(false);
            syncList();
            renderRef.current();
            toast(t('{n} anotasi tersimpan.', { n: s.annotations.length }), 'success');
        } catch (error) {
            console.error('Failed to save slide annotations:', error);
            if (error.status === 409) {
                toast(error.message, 'error');
                if (window.confirm(t('Anotasi slide ini sudah diubah orang lain sejak Anda membukanya.\n\nMuat versi terbaru? Perubahan Anda yang belum disimpan akan hilang.'))) {
                    loadAnnotations().catch(() => toast('Anotasi gagal dimuat ulang.', 'error'));
                }
            } else {
                toast(t('Gagal menyimpan: {message}', { message: error.message }), 'error');
            }
        } finally {
            setSaving(false);
        }
    }

    function exportJson() {
        const s = stateRef.current;
        if (!s.slide) return;
        const blob = new Blob([JSON.stringify(s.annotations, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${displayName(s.slide)}-anotasi.json`;
        link.click();
        URL.revokeObjectURL(url);
    }

    function commitText(value) {
        const text = value.trim();
        if (text && textInput) addAnnotation({ type: 'text', x: textInput.x, y: textInput.y, text, color: stateRef.current.color });
        setTextInput(null);
    }

    // Keyboard shortcuts (only for the focused viewer and while no text field has focus).
    const actionsRef = useRef(null);
    actionsRef.current = { save, undo, applyTool, deleteAnnotation, select, toggleEdgeRulers };
    useEffect(() => {
        if (!keyboard) return undefined;
        const onKeyDown = event => {
            if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
            if (document.querySelector('.modal.d-block')) return;
            const viewer = viewerRef.current;
            if (!viewer) return;
            const key = event.key.toLowerCase();
            const actions = actionsRef.current;
            const s = stateRef.current;

            if ((event.ctrlKey || event.metaKey) && key === 's') {
                if (!s.editable) return;
                event.preventDefault();
                actions.save();
            } else if ((event.ctrlKey || event.metaKey) && key === 'z') {
                if (!s.editable) return;
                event.preventDefault();
                actions.undo();
            } else if (event.ctrlKey || event.metaKey || event.altKey) {
                return;
            } else if ((key === 'delete' || key === 'backspace') && s.editable && s.selectedId) {
                event.preventDefault();
                actions.deleteAnnotation(s.selectedId);
            } else if (TOOL_KEYS[key] && (s.editable || VIEW_TOOLS.some(item => item.id === TOOL_KEYS[key]))) {
                actions.applyTool(TOOL_KEYS[key]);
            } else if (key === 'escape') {
                s.draft = null;
                s.measurement = null;
                actions.applyTool('pan');
                actions.select(null);
            } else if (key === '+' || key === '=') {
                viewer.viewport.zoomBy(1.5);
            } else if (key === '-') {
                viewer.viewport.zoomBy(1 / 1.5);
            } else if (key === '0') {
                viewer.viewport.goHome();
            } else if (key === 'g') {
                actions.toggleEdgeRulers();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [keyboard]);

    useEffect(() => {
        if (!colorOpen) return undefined;
        const close = event => {
            if (!event.target.closest('.color-control')) setColorOpen(false);
        };
        document.addEventListener('click', close);
        return () => document.removeEventListener('click', close);
    }, [colorOpen]);

    const presets = MAG_PRESETS.filter(value => value <= scannerMag * 2);
    const showPanel = panelOpen && !compact && showAnnotations && status !== 'empty';
    // Without edit rights the palette only offers panning and a temporary ruler.
    const showViewTools = !editable && !compact && status !== 'empty';
    const showEdgeRulers = edgeRulers && !compact && status !== 'empty';
    const measureLength = ann => formatLength(rulerLength(ann) * micronsPerPixelOf(slide), !hasMeasuredMpp(slide));
    const stageClass = [
        'viewer-stage',
        compact && 'is-compact',
        (editable || tool === 'ruler') && tool !== 'pan' && 'is-drawing',
        editable && tool === 'text' && 'is-text-tool',
        showPanel && 'has-ann-panel',
        showEdgeRulers && 'has-edge-rulers',
    ].filter(Boolean).join(' ');

    return (
        <div className={stageClass} data-unsaved={dirty ? 'true' : undefined}>
            <div className="viewer-main" ref={stageRef}>
                <div className="osd-container" ref={containerRef} />

                {showEdgeRulers && (
                    <>
                        <canvas className="edge-ruler edge-ruler-top" ref={rulerTopRef} aria-hidden="true" />
                        <canvas className="edge-ruler edge-ruler-left" ref={rulerLeftRef} aria-hidden="true" />
                        <div className="edge-ruler-corner" ref={rulerCornerRef} aria-hidden="true" />
                    </>
                )}

                {editable && (
                    <div className="tool-palette" role="toolbar" aria-label={t('Alat anotasi')}>
                        {TOOLS.map((item, index) => (
                            <span key={item.id} className="contents">
                                <button type="button" className={`tool-btn${tool === item.id ? ' active' : ''}`}
                                    data-tip={`${t(item.label)} (${item.key})`} aria-label={t(item.label)} aria-pressed={tool === item.id}
                                    onClick={() => applyTool(item.id)}>
                                    <i className={item.icon} aria-hidden="true" />
                                </button>
                                {index === 0 && <span className="tool-sep" aria-hidden="true" />}
                            </span>
                        ))}
                        <span className="tool-sep" aria-hidden="true" />
                        <div className="color-control">
                            <button type="button" className="tool-btn" data-tip={t('Warna')} aria-label={t('Pilih warna')}
                                aria-expanded={colorOpen} onClick={() => setColorOpen(open => !open)}>
                                <span className="color-dot" style={{ background: color }} />
                            </button>
                            {colorOpen && (
                                <div className="color-popover">
                                    {ANNOTATION_COLORS.map(swatch => (
                                        <button key={swatch.value} type="button"
                                            className={`swatch${color === swatch.value ? ' active' : ''}`}
                                            style={{ '--swatch': swatch.value }} aria-label={t(swatch.label)}
                                            onClick={() => { applyColor(swatch.value); setColorOpen(false); }} />
                                    ))}
                                    <label className="swatch swatch-custom" title={t('Warna lain')}>
                                        <i className="fas fa-eye-dropper" aria-hidden="true" />
                                        <input type="color" value={color} aria-label={t('Warna lain')}
                                            onChange={event => applyColor(event.target.value)} />
                                    </label>
                                </div>
                            )}
                        </div>
                        <span className="tool-sep" aria-hidden="true" />
                        <button type="button" className="tool-btn" data-tip={t('Batalkan (Ctrl+Z)')} aria-label={t('Batalkan anotasi terakhir')} onClick={undo}>
                            <i className="fas fa-reply" aria-hidden="true" />
                        </button>
                        <button type="button" className="tool-btn" data-tip={t('Hapus semua anotasi')} aria-label={t('Hapus semua anotasi')} onClick={clearAll}>
                            <i className="far fa-trash-alt" aria-hidden="true" />
                        </button>
                        <span className="tool-sep" aria-hidden="true" />
                        <button type="button" className={`tool-btn${dirty ? ' is-dirty' : ''}`} data-tip={t('Simpan (Ctrl+S)')}
                            aria-label={t('Simpan anotasi')} onClick={save} disabled={saving}>
                            <i className="far fa-save" aria-hidden="true" />
                            <span className="dirty-dot" aria-hidden="true" />
                        </button>
                        <button type="button" className="tool-btn" data-tip={t('Unduh anotasi (JSON)')} aria-label={t('Unduh anotasi')} onClick={exportJson}>
                            <i className="fas fa-file-download" aria-hidden="true" />
                        </button>
                    </div>
                )}

                {showViewTools && (
                    <div className="tool-palette" role="toolbar" aria-label={t('Alat ukur')}>
                        {VIEW_TOOLS.map((item, index) => (
                            <span key={item.id} className="contents">
                                <button type="button" className={`tool-btn${tool === item.id ? ' active' : ''}`}
                                    data-tip={`${t(item.label)} (${item.key})`} aria-label={t(item.label)} aria-pressed={tool === item.id}
                                    onClick={() => applyTool(item.id)}>
                                    <i className={item.icon} aria-hidden="true" />
                                </button>
                                {index === 0 && <span className="tool-sep" aria-hidden="true" />}
                            </span>
                        ))}
                    </div>
                )}

                {!compact && showAnnotations && status !== 'empty' && !showPanel && (
                    <button type="button" className="ann-toggle" onClick={() => setPanelOpen(true)}>
                        <i className="fas fa-list-ul" aria-hidden="true" />
                        {t('Daftar anotasi')} <span className="ann-toggle-count">{list.length}</span>
                    </button>
                )}


                {textInput && (
                    <input
                        key={textInput.id}
                        type="text"
                        className="text-annotation-input"
                        placeholder={t('Ketik teks, lalu Enter')}
                        maxLength={1000}
                        autoFocus
                        style={{ left: textInput.left, top: textInput.top, borderColor: color }}
                        onKeyDown={event => {
                            event.stopPropagation();
                            if (event.key === 'Enter') commitText(event.currentTarget.value);
                            else if (event.key === 'Escape') setTextInput(null);
                        }}
                        onBlur={() => {
                            // Clicking elsewhere cancels; a newer input opened by that click stays open.
                            const { id } = textInput;
                            setTimeout(() => setTextInput(current => (current?.id === id ? null : current)), 150);
                        }}
                    />
                )}

                {status !== 'empty' && (
                    <>
                        <div className="mag-bar" role="group" aria-label={t('Perbesaran')}>
                            <span className="mag-current" title={t('Perbesaran saat ini')}>{formatMag(magnification)}</span>
                            <span className="mag-sep" aria-hidden="true" />
                            {compact ? (
                                // Compare panels are narrow: preset buttons instead of the slider.
                                <div className="mag-presets">
                                    {presets.map(mag => (
                                        <button key={mag} type="button"
                                            className={`mag-btn${Math.abs(magnification - mag) / mag < 0.06 ? ' active' : ''}`}
                                            title={`${t('Perbesaran')} ${mag}×${mag > scannerMag ? ` (${t('digital')})` : ''}`}
                                            onClick={() => zoomToMagnification(viewerRef.current, scannerMag, mag)}>
                                            {mag}×
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <>
                                    <button type="button" className="mag-btn" title={t('Tampilkan seluruh slide')}
                                        onClick={() => viewerRef.current?.viewport.goHome()}>{t('Fit')}</button>
                                    <MagnificationSlider
                                        magnification={magnification}
                                        min={minMagnification}
                                        max={scannerMag * 2}
                                        presets={presets}
                                        scannerMag={scannerMag}
                                        onChange={(mag, immediately) => zoomToMagnification(viewerRef.current, scannerMag, mag, immediately)}
                                    />
                                </>
                            )}
                            {!compact && (
                                <>
                                    <span className="mag-sep" aria-hidden="true" />
                                    <button type="button" className={`mag-btn${edgeRulers ? ' active' : ''}`}
                                        title={`${t('Penggaris tepi layar')} (G)`} aria-pressed={edgeRulers} onClick={toggleEdgeRulers}>
                                        <i className="fas fa-ruler-combined" aria-hidden="true" />
                                    </button>
                                </>
                            )}
                        </div>

                        <div className="scale-bar" aria-hidden="true">
                            <span className="scale-bar-label" ref={scaleLabelRef} />
                            <span className="scale-bar-line" ref={scaleLineRef} />
                        </div>

                        <div className="cursor-info" ref={cursorRef} aria-hidden="true" />
                    </>
                )}

                {status === 'loading' && slide?.dzi && (
                    <div className="viewer-loading">
                        <div className="spinner" aria-hidden="true" />
                        <span>{t('Memuat slide…')}</span>
                    </div>
                )}
                {status === 'error' && (
                    <div className="viewer-error">
                        <i className="fas fa-exclamation-triangle" aria-hidden="true" />
                        <span>{t('Slide tidak dapat dibuka. Pastikan file DZI tersedia.')}</span>
                    </div>
                )}
            </div>

            {showPanel && (
                <AnnotationPanel
                    annotations={list}
                    selectedId={selectedId}
                    editable={editable}
                    dirty={dirty}
                    saving={saving}
                    measure={measureLength}
                    onSelect={focusAnnotation}
                    onUpdate={updateAnnotation}
                    onDelete={deleteAnnotation}
                    onSave={save}
                    onClose={() => setPanelOpen(false)}
                />
            )}
        </div>
    );
}
