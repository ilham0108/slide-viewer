import { useI18n } from '../i18n';
import { CASE_STATUSES } from '../utils/format';

export function CategoryBadge({ category }) {
    if (!category) return <span className="text-muted small">—</span>;
    return (
        <span className="category-badge">
            <span className="category-dot" style={{ background: category.color }} />{category.name}
        </span>
    );
}

export function StatusBadge({ status }) {
    const { t } = useI18n();
    const label = t(CASE_STATUSES[status]?.label || status);
    return <span className={`status-badge status-${status}`}>{label}</span>;
}
