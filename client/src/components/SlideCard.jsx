import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { displayName, formatDate } from '../utils/format';
import { t } from '../i18n';

/** Lowest pyramid level that fits in one tile: a cheap thumbnail without a separate image. */
export function SlideThumbnail({ slide }) {
    const [src, setSrc] = useState(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!slide.dzi) return undefined;
        const controller = new AbortController();
        fetch(slide.dzi, { signal: controller.signal })
            .then(response => {
                if (!response.ok) throw new Error(`Could not read ${slide.name} metadata`);
                return response.text();
            })
            .then(xml => {
                const dzi = new DOMParser().parseFromString(xml, 'application/xml');
                const image = dzi.documentElement;
                const size = dzi.getElementsByTagNameNS('*', 'Size')[0];
                const width = Number(size?.getAttribute('Width'));
                const height = Number(size?.getAttribute('Height'));
                const tileSize = Number(image.getAttribute('TileSize'));
                const format = image.getAttribute('Format');
                if (!width || !height || !tileSize || !/^[a-z0-9]+$/i.test(format || '')) {
                    throw new Error(`Invalid DZI metadata for ${slide.name}`);
                }
                const maxLevel = Math.ceil(Math.log2(Math.max(width, height)));
                const thumbnailLevel = Math.max(0, maxLevel - Math.ceil(Math.log2(tileSize)));
                // Tiles sit next to the .dzi (works for /slides/... and for public /share-tiles/...).
                setSrc(`${slide.dzi.replace(/\.dzi$/i, '_files')}/${thumbnailLevel}/0_0.${format}`);
            })
            .catch(error => {
                if (error.name !== 'AbortError') setFailed(true);
            });
        return () => controller.abort();
    }, [slide.dzi, slide.name]);

    if (failed || !slide.dzi) {
        return <span className="slide-thumbnail-placeholder"><i className="far fa-image" aria-hidden="true" /></span>;
    }
    return src ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} /> : null;
}

function ProcessingOverlay({ slide }) {
    if (slide.status === 'processing') {
        return (
            <span className="slide-card-overlay">
                <span className="small fw-semibold">{t('Mengonversi…')}{' '}{slide.progress}%</span>
                <span className="progress w-75" style={{ height: 6 }}>
                    <span className="progress-bar progress-bar-striped progress-bar-animated" style={{ width: `${slide.progress}%` }} />
                </span>
            </span>
        );
    }
    if (slide.status === 'failed') {
        return (
            <span className="slide-card-overlay text-danger">
                <i className="fas fa-exclamation-triangle" aria-hidden="true" />
                <span className="small fw-semibold">{t('Slide tidak dapat dibuka')}</span>
            </span>
        );
    }
    return null;
}

/**
 * Slide tile used by the case page and the library. `actions` is a list of
 * { label, icon, onClick, danger } shown in a small menu; `selected`/`onToggleSelect`
 * enable the checkbox used to pick slides for comparison.
 */
export default function SlideCard({ slide, index = 0, showCase = false, actions = [], selected, onToggleSelect, href }) {
    const [menuOpen, setMenuOpen] = useState(false);
    const ready = slide.status === 'ready';
    const parts = [];
    if (slide.magnification) parts.push(`${slide.magnification}×`);
    if (slide.createdAt) parts.push(formatDate(slide.createdAt));

    const preview = (
        <>
            <span className="slide-card-preview">
                <SlideThumbnail slide={slide} />
                <ProcessingOverlay slide={slide} />
            </span>
            <span className="slide-card-body">
                <span className="slide-card-title" title={slide.originalName}>{displayName(slide)}</span>
                <span className="slide-card-meta">{parts.join(' · ')}</span>
                {showCase && (
                    <span className="slide-card-case">
                        {slide.case ? (
                            <>
                                <span className="category-dot" style={{ background: slide.case.categoryColor || '#9ca3af' }} />
                                {slide.case.title
                                    ? <><span className="slide-card-case-name">{slide.case.title}</span><span className="text-muted"> · {slide.case.caseNumber}</span></>
                                    : <span className="slide-card-case-name">{slide.case.caseNumber}</span>}
                            </>
                        ) : slide.category ? (
                            <>
                                <span className="category-dot" style={{ background: slide.category.color }} />
                                {slide.category.name}
                                <span className="text-muted fst-italic"> · {t('tanpa case')}</span>
                            </>
                        ) : <span className="text-muted fst-italic">{t('Tanpa case')}</span>}
                    </span>
                )}
            </span>
        </>
    );

    return (
        <div className={`slide-card${selected ? ' is-selected' : ''}`} style={{ animationDelay: `${Math.min(index, 12) * 0.03}s` }}>
            {ready ? (
                <Link to={href || `/viewer/${slide.id}`} className="slide-card-link" aria-label={t('Buka slide {name}', { name: displayName(slide) })}>
                    {preview}
                </Link>
            ) : <div className="slide-card-link">{preview}</div>}

            {ready && onToggleSelect && (
                <label className="slide-card-check" title={t('Pilih untuk dibandingkan')}>
                    <input type="checkbox" className="form-check-input" checked={Boolean(selected)} onChange={() => onToggleSelect(slide)} />
                </label>
            )}

            {actions.length > 0 && (
                <div className="slide-card-menu">
                    <button type="button" className="icon-btn icon-btn-sm" aria-label={t('Aksi slide')} aria-expanded={menuOpen}
                        onClick={() => setMenuOpen(open => !open)}>
                        <i className="fas fa-ellipsis-v" aria-hidden="true" />
                    </button>
                    {menuOpen && (
                        <>
                            <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
                            <div className="menu menu-end menu-up">
                                {actions.map(action => (
                                    <button key={action.label} type="button"
                                        className={`menu-item${action.danger ? ' text-danger' : ''}`}
                                        onClick={() => { setMenuOpen(false); action.onClick(slide); }}>
                                        <i className={`fas ${action.icon}`} aria-hidden="true" /> {t(action.label)}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
