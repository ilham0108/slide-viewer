import { useCallback, useEffect, useState } from 'react';
import { t } from '../i18n';

export function useFullscreen(elementRef) {
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        const onChange = () => setIsFullscreen(document.fullscreenElement === elementRef.current);
        document.addEventListener('fullscreenchange', onChange);
        return () => {
            document.removeEventListener('fullscreenchange', onChange);
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        };
    }, [elementRef]);

    const toggleFullscreen = useCallback(() => {
        if (document.fullscreenElement) document.exitFullscreen();
        else elementRef.current?.requestFullscreen?.();
    }, [elementRef]);

    return { isFullscreen, toggleFullscreen };
}

/** Zoom, rotate and full-screen buttons for one viewer (or for every viewer in `viewers`). */
export function ViewerControls({ viewer, viewers, isFullscreen, onToggleFullscreen, children }) {
    const targets = viewers || (viewer ? [viewer] : []);
    const each = action => () => targets.forEach(target => action(target.viewport));

    return (
        <div className="vt-group" role="group" aria-label={t('Kontrol tampilan')}>
            <button type="button" className="vt-btn" title={t('Perkecil (−)')} aria-label={t('Perkecil')}
                onClick={each(viewport => { viewport.zoomBy(1 / 1.5); viewport.applyConstraints(); })}>
                <i className="fas fa-minus" aria-hidden="true" />
            </button>
            <button type="button" className="vt-btn" title={t('Perbesar (+)')} aria-label={t('Perbesar')}
                onClick={each(viewport => { viewport.zoomBy(1.5); viewport.applyConstraints(); })}>
                <i className="fas fa-plus" aria-hidden="true" />
            </button>
            <button type="button" className="vt-btn" title={t('Tampilkan seluruh slide (0)')} aria-label={t('Tampilkan seluruh slide')}
                onClick={each(viewport => viewport.goHome())}>
                <i className="fas fa-compress-arrows-alt" aria-hidden="true" />
            </button>
            <span className="vt-divider vt-hide-sm" aria-hidden="true" />
            <button type="button" className="vt-btn vt-hide-sm" title={t('Putar ke kiri')} aria-label={t('Putar ke kiri')}
                onClick={each(viewport => viewport.setRotation(viewport.getRotation() - 90))}>
                <i className="fas fa-undo-alt" aria-hidden="true" />
            </button>
            <button type="button" className="vt-btn vt-hide-sm" title={t('Putar ke kanan')} aria-label={t('Putar ke kanan')}
                onClick={each(viewport => viewport.setRotation(viewport.getRotation() + 90))}>
                <i className="fas fa-redo-alt" aria-hidden="true" />
            </button>
            <span className="vt-divider" aria-hidden="true" />
            <button type="button" className="vt-btn" title={t('Layar penuh')} aria-label={t('Layar penuh')} onClick={onToggleFullscreen}>
                <i className={`fas ${isFullscreen ? 'fa-compress' : 'fa-expand'}`} aria-hidden="true" />
            </button>
            {children}
        </div>
    );
}
