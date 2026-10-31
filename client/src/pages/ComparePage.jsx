import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import OpenSeadragon from 'openseadragon';
import { api } from '../api';
import { LoadingState } from '../components/States';
import { useToast } from '../components/Toast';
import { caseLabel, displayName } from '../utils/format';
import SlideViewer from '../viewer/SlideViewer';
import { useAuth } from '../auth/AuthContext';
import ShareDialog from '../components/ShareDialog';
import { SlideThumbnail } from '../components/SlideCard';
import SlidePicker from '../viewer/SlidePicker';
import { currentMagnification, getViewState, micronsPerPixelOf, scannerMagOf, tiledImage } from '../viewer/magnification';
import { ViewerControls, useFullscreen } from '../viewer/ViewerControls';
import { HelpModal } from './ViewerPage';
import { t } from '../i18n';

const LAYOUTS = [
    { count: 1, icon: 'fa-square', label: '1 panel' },
    { count: 2, icon: 'fa-columns', label: '2 panel' },
    { count: 3, icon: 'fa-grip-lines-vertical', label: '3 panel' },
    { count: 4, icon: 'fa-th-large', label: '4 panel' },
];
const MAX_PANELS = 4;

function parseIds(value) {
    return (value || '').split(',').map(Number).filter(id => Number.isSafeInteger(id) && id > 0).slice(0, MAX_PANELS);
}

/** Panel header button showing the panel's slide; it opens the thumbnail picker. */
function SlidePickButton({ slide, onClick }) {
    return (
        <button type="button" className="compare-pick" onClick={onClick} title={slide ? displayName(slide) : t('Pilih slide')}>
            {slide ? (
                <>
                    <span className="compare-pick-thumb"><SlideThumbnail slide={slide} /></span>
                    <span className="compare-pick-name">{displayName(slide)}</span>
                </>
            ) : (
                <span className="compare-pick-name is-placeholder">{t('— Pilih slide —')}</span>
            )}
            <i className="fas fa-chevron-down compare-pick-caret" aria-hidden="true" />
        </button>
    );
}

/**
 * Split view: up to four slides side by side. With "Sinkron" on, panning and zooming one
 * panel moves the others by the same physical distance (µm) and to the same magnification,
 * starting from wherever each panel was when sync was turned on. That keeps serial sections
 * aligned even when they sit at different positions on their glass slides.
 *
 * Used by the compare page and by public share links:
 *   slides             slides that can be picked for a panel
 *   initialPanels      slide id per panel (null = empty panel)
 *   initialViews       optional saved position per panel (see getViewState)
 *   annotationsPathFor slide => API path of its annotations (default: the logged-in API)
 *   slideLink          slide => URL of the single-slide viewer
 *   renderActions      ({ getShareState, hasSlides }) => extra top-bar buttons
 */
export function CompareWorkspace({
    slides,
    initialPanels,
    initialViews,
    initialSync = false,
    annotationsPathFor,
    slideLink = slide => `/viewer/${slide.id}`,
    onPanelsChange,
    title = 'Bandingkan Slide',
    renderActions,
}) {
    const [panels, setPanels] = useState(initialPanels);
    const [syncEnabled, setSyncEnabled] = useState(initialSync);
    const [showAnnotations, setShowAnnotations] = useState(true);
    const [activeIndex, setActiveIndex] = useState(0);
    const [viewers, setViewers] = useState([]);
    const [showHelp, setShowHelp] = useState(false);
    const screenRef = useRef(null);
    const { isFullscreen, toggleFullscreen } = useFullscreen(screenRef);

    const viewersRef = useRef(new Map());
    const panelsRef = useRef(panels);
    const slidesById = useMemo(() => new Map(slides.map(slide => [slide.id, slide])), [slides]);
    const slidesByIdRef = useRef(slidesById);
    slidesByIdRef.current = slidesById;
    const syncRef = useRef({ enabled: initialSync, leader: 0, applying: false, baseline: new Map() });

    useEffect(() => {
        panelsRef.current = panels;
        onPanelsChange?.(panels);
    }, [panels, onPanelsChange]);

    /** Layout, slides, positions and sync state for a share link. */
    const getShareState = useCallback(() => {
        const filled = panels.map((slideId, index) => ({ slideId, index })).filter(panel => panel.slideId);
        return {
            slides: filled.map(panel => panel.slideId),
            panels: filled.map(panel => getViewState(
                viewersRef.current.get(panel.index),
                scannerMagOf(slidesByIdRef.current.get(panel.slideId))
            )),
            sync: syncRef.current.enabled,
        };
    }, [panels]);

    // ------------------------------------------------------------------
    // Synchronisation
    // ------------------------------------------------------------------
    const panelInfo = useCallback(index => {
        const viewer = viewersRef.current.get(index);
        const slide = slidesByIdRef.current.get(panelsRef.current[index]);
        const item = tiledImage(viewer);
        if (!viewer || !slide || !item) return null;
        const scannerMag = scannerMagOf(slide);
        return { viewer, item, scannerMag, um: micronsPerPixelOf(slide) };
    }, []);

    const captureBaseline = useCallback(() => {
        const { baseline } = syncRef.current;
        baseline.clear();
        for (const index of viewersRef.current.keys()) {
            const info = panelInfo(index);
            if (!info) continue;
            const center = info.item.viewportToImageCoordinates(info.viewer.viewport.getCenter(true));
            baseline.set(index, { x: center.x * info.um, y: center.y * info.um });
        }
    }, [panelInfo]);

    const follow = useCallback(leaderIndex => {
        const sync = syncRef.current;
        if (!sync.enabled || sync.applying || sync.leader !== leaderIndex) return;
        const leader = panelInfo(leaderIndex);
        const leaderBase = sync.baseline.get(leaderIndex);
        if (!leader || !leaderBase) return;

        const center = leader.item.viewportToImageCoordinates(leader.viewer.viewport.getCenter(true));
        const dx = center.x * leader.um - leaderBase.x;
        const dy = center.y * leader.um - leaderBase.y;
        const mag = currentMagnification(leader.viewer, leader.scannerMag);

        sync.applying = true;
        try {
            for (const index of viewersRef.current.keys()) {
                if (index === leaderIndex) continue;
                const follower = panelInfo(index);
                const base = sync.baseline.get(index);
                if (!follower || !base) continue;
                const target = new OpenSeadragon.Point((base.x + dx) / follower.um, (base.y + dy) / follower.um);
                follower.viewer.viewport.zoomTo(follower.item.imageToViewportZoom(mag / follower.scannerMag), null, true);
                follower.viewer.viewport.panTo(follower.item.imageToViewportCoordinates(target), true);
            }
        } finally {
            sync.applying = false;
        }
    }, [panelInfo]);

    const toggleSync = () => {
        const enabled = !syncEnabled;
        syncRef.current.enabled = enabled;
        if (enabled) captureBaseline();
        setSyncEnabled(enabled);
    };

    // One stable onReady callback per panel slot, so viewers are not recreated on re-render.
    const readyCallbacks = useMemo(() => Array.from({ length: MAX_PANELS }, (_, index) => viewer => {
        if (viewer) {
            viewersRef.current.set(index, viewer);
            viewer.addHandler('update-viewport', () => follow(index));
            // A newly opened slide joins the sync from where it starts.
            viewer.addHandler('open', () => {
                if (syncRef.current.enabled) setTimeout(captureBaseline, 0);
            });
        } else {
            viewersRef.current.delete(index);
            syncRef.current.baseline.delete(index);
        }
        setViewers([...viewersRef.current.values()]);
    }), [follow, captureBaseline]);

    const activate = index => {
        syncRef.current.leader = index;
        if (index !== activeIndex) setActiveIndex(index);
    };

    const setPanelSlide = (index, slideId) => {
        setPanels(current => current.map((value, i) => (i === index ? slideId : value)));
    };

    // Index of the panel whose slide is being chosen in the picker, or null.
    const [pickingPanel, setPickingPanel] = useState(null);
    const closePicker = useCallback(() => setPickingPanel(null), []);

    const setLayout = count => {
        setPanels(current => {
            const ids = current.filter(Boolean);
            return Array.from({ length: count }, (_, index) => current[index] ?? ids[index] ?? null);
        });
        setActiveIndex(index => Math.min(index, count - 1));
    };

    const removePanel = index => {
        setPanels(current => (current.length > 1 ? current.filter((_, i) => i !== index) : [null]));
        setActiveIndex(0);
    };

    return (
        <div className="viewer-screen" ref={screenRef}>
            <div className="viewer-topbar">
                <div className="vt-title">
                    <h1>{t(title)}</h1>
                    <span>{t('{filled} dari {total} panel terisi', { filled: panels.filter(Boolean).length, total: panels.length })}</span>
                </div>
                <div className="vt-group" role="group" aria-label={t('Tata letak')}>
                    {LAYOUTS.map(layout => (
                        <button key={layout.count} type="button" title={t(layout.label)} aria-label={t(layout.label)}
                            className={`vt-btn${panels.length === layout.count ? ' active' : ''}`}
                            onClick={() => setLayout(layout.count)}>
                            <span className="layout-icon">{layout.count}</span>
                        </button>
                    ))}
                    <span className="vt-divider" aria-hidden="true" />
                    <button type="button" className={`vt-btn vt-toggle${syncEnabled ? ' active' : ''}`} onClick={toggleSync}
                        disabled={panels.length < 2}
                        title={t('Sinkronkan geser dan zoom antar panel, mulai dari posisi masing-masing saat ini')}>
                        <i className={`fas ${syncEnabled ? 'fa-link' : 'fa-unlink'}`} aria-hidden="true" />
                        <span>{t('Sinkron')}</span>
                    </button>
                    <button type="button" className={`vt-btn vt-toggle${showAnnotations ? ' active' : ''}`}
                        onClick={() => setShowAnnotations(value => !value)} title={t('Tampilkan anotasi tersimpan')}>
                        <i className="fas fa-draw-polygon" aria-hidden="true" />
                        <span className="vt-hide-sm">{t('Anotasi')}</span>
                    </button>
                </div>
                <ViewerControls viewers={viewers} isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen}>
                    {renderActions?.({ getShareState, hasSlides: panels.some(Boolean) })}
                    <button type="button" className="vt-btn" title={t('Bantuan')} onClick={() => setShowHelp(true)}>
                        <i className="far fa-question-circle" aria-hidden="true" />
                    </button>
                </ViewerControls>
            </div>

            <div className={`compare-grid layout-${panels.length}`}>
                {panels.map((slideId, index) => {
                    const slide = slideId ? slidesByIdRef.current.get(slideId) : null;
                    return (
                        // Panels are keyed by position so a viewer survives when its slide changes.
                        // eslint-disable-next-line react/no-array-index-key
                        <section key={index}
                            className={`compare-panel${index === activeIndex && panels.length > 1 ? ' is-active' : ''}`}
                            onPointerEnter={() => activate(index)}
                            onPointerDown={() => activate(index)}>
                            <header className="compare-panel-header">
                                <span className="compare-panel-index">{index + 1}</span>
                                <SlidePickButton slide={slide} onClick={() => setPickingPanel(index)} />
                                {slide?.case && <span className="compare-panel-case d-none d-xl-inline" title={caseLabel(slide.case)}>{slide.case.title || slide.case.caseNumber}</span>}
                                {slide && (
                                    <Link to={slideLink(slide)} className="btn btn-sm btn-link" title={t('Buka di viewer tunggal')}>
                                        <i className="fas fa-external-link-alt" aria-hidden="true" />
                                    </Link>
                                )}
                                {panels.length > 1 && (
                                    <button type="button" className="btn btn-sm btn-link text-muted" title={t('Tutup panel')} onClick={() => removePanel(index)}>
                                        <i className="fas fa-times" aria-hidden="true" />
                                    </button>
                                )}
                            </header>
                            <div className="compare-panel-body">
                                <SlideViewer
                                    slide={slide}
                                    compact
                                    showAnnotations={showAnnotations}
                                    keyboard={index === activeIndex && !showHelp}
                                    onReady={readyCallbacks[index]}
                                    annotationsPath={slide && annotationsPathFor ? annotationsPathFor(slide) : undefined}
                                    initialView={slideId && slideId === initialPanels[index] ? initialViews?.[index] : undefined}
                                />
                                {!slide && (
                                    <div className="compare-empty">
                                        <i className="far fa-image" aria-hidden="true" />
                                        <span>{t('Pilih slide untuk panel ini')}</span>
                                        <button type="button" className="btn btn-sm btn-primary" onClick={() => setPickingPanel(index)}>
                                            <i className="fas fa-th-large me-2" aria-hidden="true" />{t('Pilih slide')}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </section>
                    );
                })}
            </div>
            {pickingPanel !== null && (
                <SlidePicker
                    slides={slides}
                    panelIndex={pickingPanel}
                    panelSlides={panels}
                    onPick={id => {
                        setPanelSlide(pickingPanel, id);
                        closePicker();
                    }}
                    onClose={closePicker}
                />
            )}
            {showHelp && <HelpModal onClose={() => setShowHelp(false)} editable={false} />}
        </div>
    );
}

/** Logged-in compare page: any available slide, with the panel layout kept in the URL. */
export default function ComparePage() {
    const toast = useToast();
    const { can } = useAuth();
    const [params, setParams] = useSearchParams();
    const [slides, setSlides] = useState(null);
    const [sharing, setSharing] = useState(null);
    const [initialPanels] = useState(() => {
        const ids = parseIds(params.get('slides'));
        const count = Math.min(MAX_PANELS, Math.max(Number(params.get('layout')) || 0, ids.length, 2));
        return Array.from({ length: count }, (_, index) => ids[index] || null);
    });

    useEffect(() => {
        api('/slides')
            .then(setSlides)
            .catch(error => {
                toast(error.message, 'error');
                setSlides([]);
            });
    }, [toast]);

    // Keep the URL shareable within the app: /compare?slides=12,15&layout=2
    const onPanelsChange = useCallback(panels => {
        const ids = panels.filter(Boolean);
        const next = new URLSearchParams();
        if (ids.length) next.set('slides', ids.join(','));
        next.set('layout', String(panels.length));
        setParams(next, { replace: true });
    }, [setParams]);

    if (!slides) return <div className="page"><LoadingState message={t('Memuat daftar slide…')} /></div>;

    return (
        <>
            <CompareWorkspace
                slides={slides}
                initialPanels={initialPanels}
                onPanelsChange={onPanelsChange}
                renderActions={({ getShareState, hasSlides }) => can('shares.create') && (
                    <button type="button" className="vt-btn vt-share" disabled={!hasSlides}
                        title={t('Bagikan tampilan perbandingan ini')} onClick={() => setSharing(() => getShareState)}>
                        <i className="fas fa-share-alt" aria-hidden="true" /><span className="vt-hide-sm">{t('Bagikan')}</span>
                    </button>
                )}
            />
            {sharing && (
                <ShareDialog
                    target={{ type: 'compare', label: 'Tampilan perbandingan saat ini', getViewState: sharing }}
                    onClose={() => setSharing(null)}
                />
            )}
        </>
    );
}
