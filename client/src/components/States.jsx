import { useI18n } from '../i18n';

// Plain-string props are Indonesian source texts and are translated here.
const useText = () => {
    const { t } = useI18n();
    return value => (typeof value === 'string' ? t(value) : value);
};

export function LoadingState({ message = 'Memuat…', fullScreen = false }) {
    const text = useText();
    return (
        <div className={`state-loading${fullScreen ? ' state-full' : ''}`}>
            <div className="spinner" aria-hidden="true" />
            <span>{text(message)}</span>
        </div>
    );
}

export function EmptyState({ icon = 'fa-folder-open', message, description, children, tone }) {
    const text = useText();
    return (
        <div className={`empty-state${tone ? ` is-${tone}` : ''}`}>
            <span className="empty-icon"><i className={`fas ${icon}`} aria-hidden="true" /></span>
            <h2 className="empty-title">{text(message)}</h2>
            {description && <p className="empty-desc">{text(description)}</p>}
            {children && <div className="empty-actions">{children}</div>}
        </div>
    );
}

export function PageHeader({ title, subtitle, actions, back, eyebrow }) {
    const text = useText();
    return (
        <div className="page-header">
            <div className="page-header-text">
                {back}
                <h1 className="page-title">{eyebrow}{text(title)}</h1>
                {subtitle && <p className="page-subtitle">{text(subtitle)}</p>}
            </div>
            {actions && <div className="page-actions">{actions}</div>}
        </div>
    );
}
