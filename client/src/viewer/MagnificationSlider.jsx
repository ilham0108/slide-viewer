import { useRef } from 'react';
import { formatMag } from '../utils/format';
import { t } from '../i18n';

// Arrow keys move the slider by this share of its length.
const KEY_STEP = 0.05;

/**
 * Horizontal magnification slider on a logarithmic scale, so 1×→2× takes as much room as
 * 40×→80×. `min` is the whole slide in view, `max` the digital-zoom limit. Presets are
 * shown under the track and jump there when clicked.
 *
 * onChange(magnification, immediately): immediately is true while dragging, so the slide
 * follows the thumb instead of animating behind it.
 */
export default function MagnificationSlider({ magnification, min, max, presets, scannerMag, onChange }) {
    const trackRef = useRef(null);
    const draggingRef = useRef(false);
    const usable = min > 0 && max > min;
    const logMin = Math.log(min);
    const logRange = Math.log(max) - logMin;

    const toFraction = value => (usable ? Math.min(1, Math.max(0, (Math.log(value) - logMin) / logRange)) : 0);
    const toMagnification = fraction => Math.exp(logMin + Math.min(1, Math.max(0, fraction)) * logRange);

    const fromPointer = event => {
        const rect = trackRef.current.getBoundingClientRect();
        return toMagnification((event.clientX - rect.left) / rect.width);
    };

    const onPointerDown = event => {
        if (!usable || event.button !== 0) return;
        event.preventDefault();
        draggingRef.current = true;
        trackRef.current.setPointerCapture(event.pointerId);
        trackRef.current.focus();
        onChange(fromPointer(event), true);
    };
    const onPointerMove = event => {
        if (draggingRef.current) onChange(fromPointer(event), true);
    };
    const onPointerUp = event => {
        draggingRef.current = false;
        trackRef.current.releasePointerCapture?.(event.pointerId);
    };

    const onKeyDown = event => {
        if (!usable) return;
        const fraction = toFraction(magnification);
        let next = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = toMagnification(fraction + KEY_STEP);
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = toMagnification(fraction - KEY_STEP);
        else if (event.key === 'Home') next = min;
        else if (event.key === 'End') next = max;
        if (next === null) return;
        event.preventDefault();
        // The viewer's own shortcuts listen on the document; this key is handled here.
        event.stopPropagation();
        onChange(next, false);
    };

    const position = `${toFraction(magnification) * 100}%`;
    const shownPresets = usable ? presets.filter(value => value >= min * 0.98 && value <= max * 1.02) : [];

    return (
        <div className="mag-slider">
            <div
                ref={trackRef}
                className="mag-slider-track"
                role="slider"
                tabIndex={0}
                aria-label={t('Perbesaran')}
                aria-valuemin={Math.round(min * 100) / 100}
                aria-valuemax={max}
                aria-valuenow={Math.round(magnification * 100) / 100}
                aria-valuetext={formatMag(magnification)}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onKeyDown={onKeyDown}
            >
                <span className="mag-slider-rail" />
                <span className="mag-slider-fill" style={{ width: position }} />
                {shownPresets.map(value => (
                    <span key={value} className="mag-slider-tick" style={{ left: `${toFraction(value) * 100}%` }} />
                ))}
                <span className="mag-slider-thumb" style={{ left: position }} />
            </div>
            <div className="mag-slider-labels">
                {shownPresets.map(value => (
                    <button key={value} type="button"
                        className={`mag-slider-label${Math.abs(magnification - value) / value < 0.06 ? ' active' : ''}`}
                        style={{ left: `${toFraction(value) * 100}%` }}
                        title={`${t('Perbesaran')} ${value}×${value > scannerMag ? ` (${t('digital')})` : ''}`}
                        onClick={() => onChange(value, false)}>
                        {value}×
                    </button>
                ))}
            </div>
        </div>
    );
}
