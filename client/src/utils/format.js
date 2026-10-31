import { getLocale } from '../i18n';

// Formatters follow the chosen interface language; they are cheap to build per call.
export const numberFormat = { format: value => new Intl.NumberFormat(getLocale()).format(value) };

export function formatDate(value, withTime = false) {
    if (!value) return '–';
    const options = withTime
        ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { day: 'numeric', month: 'short', year: 'numeric' };
    return new Intl.DateTimeFormat(getLocale(), options).format(new Date(value));
}

// Stored names start with an upload timestamp ("1792323828884-"); users only need the original name.
/** A case on one line, its name first: "HER2 + (10)". */
export function caseLabel(item) {
    if (!item) return '';
    return item.title ? `${item.title} (${item.caseNumber})` : item.caseNumber;
}

export function displayName(slide) {
    return (slide.originalName || slide.name || '')
        .replace(/^\d{13}-/, '')
        .replace(/\.(svs|tiff?)$/i, '');
}

export function formatMag(mag) {
    if (!Number.isFinite(mag) || mag <= 0) return '–';
    const digits = mag < 9.95 ? 1 : 0; // 9.97 would otherwise show as "10,0×"
    return `${mag.toLocaleString(getLocale(), { maximumFractionDigits: digits, minimumFractionDigits: digits })}×`;
}

export function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

// Labels are Indonesian source texts; components pass them through t().
export const CASE_STATUSES = {
    open: { label: 'Terbuka' },
    in_review: { label: 'Dalam review' },
    closed: { label: 'Selesai' },
};
