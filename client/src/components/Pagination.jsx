import { useI18n } from '../i18n';

/**
 * Page numbers to show: the first and last page, and two on each side of the current one,
 * with null where pages are skipped. 1 … 4 5 [6] 7 8 … 20
 */
function pageItems(page, pageCount) {
    const pages = new Set([1, pageCount]);
    for (let value = page - 2; value <= page + 2; value += 1) {
        if (value >= 1 && value <= pageCount) pages.add(value);
    }
    const sorted = [...pages].sort((a, b) => a - b);
    const items = [];
    sorted.forEach((value, index) => {
        if (index > 0) {
            const gap = value - sorted[index - 1];
            // A gap of one page shows that page instead of "…".
            if (gap === 2) items.push(value - 1);
            else if (gap > 2) items.push(null);
        }
        items.push(value);
    });
    return items;
}

/**
 * Numbered pagination with "Showing 51–100 of 230". Renders nothing for a single page.
 * onChange(page) receives the 1-based page to show.
 */
export default function Pagination({ page, pageSize, total, onChange }) {
    const { t } = useI18n();
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    if (pageCount <= 1) return null;

    const first = (page - 1) * pageSize + 1;
    const last = Math.min(total, page * pageSize);
    const go = value => {
        if (value === page || value < 1 || value > pageCount) return;
        onChange(value);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
        <nav className="pagination-bar" aria-label={t('Navigasi halaman')}>
            <span className="pagination-summary">
                {t('Menampilkan {first}–{last} dari {total}', { first, last, total })}
            </span>
            <div className="pagination-pages">
                <button type="button" className="pagination-btn" disabled={page <= 1} onClick={() => go(page - 1)}
                    aria-label={t('Halaman sebelumnya')}>
                    <i className="fas fa-chevron-left" aria-hidden="true" />
                </button>
                {pageItems(page, pageCount).map((value, index) => (value === null ? (
                    <span key={`gap-${index}`} className="pagination-gap" aria-hidden="true">…</span>
                ) : (
                    <button key={value} type="button" className={`pagination-btn${value === page ? ' is-active' : ''}`}
                        aria-current={value === page ? 'page' : undefined} onClick={() => go(value)}>
                        {value}
                    </button>
                )))}
                <button type="button" className="pagination-btn" disabled={page >= pageCount} onClick={() => go(page + 1)}
                    aria-label={t('Halaman berikutnya')}>
                    <i className="fas fa-chevron-right" aria-hidden="true" />
                </button>
            </div>
        </nav>
    );
}
