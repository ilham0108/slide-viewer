import { useEffect, useMemo, useRef, useState } from 'react';
import { SlideThumbnail } from '../components/SlideCard';
import { caseLabel, displayName } from '../utils/format';
import { t } from '../i18n';

/** Loads the thumbnail only once the card scrolls into view: a case can hold hundreds of slides. */
function LazyThumbnail({ slide }) {
    const ref = useRef(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (visible) return undefined;
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) setVisible(true);
        }, { rootMargin: '200px' });
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [visible]);

    return <span ref={ref} className="slide-picker-thumb">{visible && <SlideThumbnail slide={slide} />}</span>;
}

/**
 * Chooses the slide of one compare panel from thumbnails grouped by case, with a search
 * box. It is rendered inside the compare screen (not in a portal) so it also works there
 * in full-screen mode.
 *
 * panelSlides: the slide id of every panel, to mark slides already shown elsewhere.
 * onPick(slideId | null): null empties the panel.
 */
export default function SlidePicker({ slides, panelIndex, panelSlides, onPick, onClose }) {
    const [query, setQuery] = useState('');
    const inputRef = useRef(null);
    const selectedId = panelSlides[panelIndex];

    useEffect(() => {
        inputRef.current?.focus();
        // Capture phase, so the viewer's keyboard shortcuts do not see this Escape.
        const onKey = event => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            onClose();
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    const groups = useMemo(() => {
        const needle = query.trim().toLowerCase();
        const byCase = new Map();
        for (const slide of slides) {
            const label = slide.case ? caseLabel(slide.case) : t(slide.groupLabel || 'Tanpa case');
            const haystack = `${displayName(slide)} ${slide.originalName || ''} ${label}`.toLowerCase();
            if (needle && !haystack.includes(needle)) continue;
            if (!byCase.has(label)) byCase.set(label, []);
            byCase.get(label).push(slide);
        }
        return [...byCase.entries()];
    }, [slides, query]);

    const panelOf = slideId => {
        const index = panelSlides.findIndex((id, i) => id === slideId && i !== panelIndex);
        return index >= 0 ? index + 1 : null;
    };

    return (
        <div className="slide-picker-backdrop" onMouseDown={event => {
            if (event.target === event.currentTarget) onClose();
        }}>
            <div className="slide-picker" role="dialog" aria-modal="true" aria-label={t('Pilih slide untuk panel {n}', { n: panelIndex + 1 })}>
                <header className="slide-picker-header">
                    <h2>{t('Pilih slide untuk panel {n}', { n: panelIndex + 1 })}</h2>
                    <div className="slide-picker-search">
                        <i className="fas fa-search" aria-hidden="true" />
                        <input ref={inputRef} type="search" value={query} placeholder={t('Cari nama slide atau case…')}
                            aria-label={t('Cari slide')} onChange={event => setQuery(event.target.value)} />
                    </div>
                    {selectedId && (
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => onPick(null)}>
                            {t('Kosongkan panel')}
                        </button>
                    )}
                    <button type="button" className="slide-picker-close" onClick={onClose} aria-label={t('Tutup')}>
                        <i className="fas fa-times" aria-hidden="true" />
                    </button>
                </header>

                <div className="slide-picker-body">
                    {!groups.length && (
                        <p className="slide-picker-empty">{query ? t('Tidak ada slide yang cocok.') : t('Belum ada slide yang siap dilihat.')}</p>
                    )}
                    {groups.map(([label, items]) => (
                        <section key={label} className="slide-picker-group">
                            <h3>{label} <span className="slide-picker-count">{items.length}</span></h3>
                            <div className="slide-picker-grid">
                                {items.map(slide => {
                                    const otherPanel = panelOf(slide.id);
                                    const selected = slide.id === selectedId;
                                    return (
                                        <button key={slide.id} type="button" className={`slide-picker-item${selected ? ' is-selected' : ''}`}
                                            onClick={() => onPick(slide.id)} title={displayName(slide)} aria-pressed={selected}>
                                            <LazyThumbnail slide={slide} />
                                            {selected && <span className="slide-picker-badge">{t('Dipilih')}</span>}
                                            {!selected && otherPanel && <span className="slide-picker-badge is-muted">{t('Panel {n}', { n: otherPanel })}</span>}
                                            <span className="slide-picker-name">{displayName(slide)}</span>
                                            {slide.magnification && <span className="slide-picker-meta">{slide.magnification}×</span>}
                                        </button>
                                    );
                                })}
                            </div>
                        </section>
                    ))}
                </div>
            </div>
        </div>
    );
}
