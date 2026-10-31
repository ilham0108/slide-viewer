import { createContext, useCallback, useContext, useState } from 'react';
import { translate } from '../i18n';

const ToastContext = createContext(() => {});
const ICONS = { info: 'fa-info-circle', success: 'fa-check-circle', error: 'fa-exclamation-circle' };
let nextId = 1;

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);

    const toast = useCallback((message, type = 'info') => {
        const id = nextId++;
        // Messages are Indonesian source texts (or already translated server messages).
        setToasts(current => [...current, { id, message: translate(message), type, hiding: false }]);
        setTimeout(() => setToasts(current => current.map(t => (t.id === id ? { ...t, hiding: true } : t))), 3200);
        setTimeout(() => setToasts(current => current.filter(t => t.id !== id)), 3600);
    }, []);

    return (
        <ToastContext.Provider value={toast}>
            {children}
            <div className="toast-stack" aria-live="polite">
                {toasts.map(t => (
                    <div key={t.id} className={`toast-item toast-${t.type}${t.hiding ? ' toast-hide' : ''}`}>
                        <i className={`fas ${ICONS[t.type] || ICONS.info}`} aria-hidden="true" />
                        <span>{t.message}</span>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    return useContext(ToastContext);
}
