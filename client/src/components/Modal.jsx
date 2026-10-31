import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';

/** Bootstrap-styled modal rendered by React (no Bootstrap JS needed). */
export default function Modal({ title, onClose, children, footer, size, onSubmit }) {
    const { t } = useI18n();
    useEffect(() => {
        const onKey = event => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        document.body.classList.add('modal-open');
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.classList.remove('modal-open');
        };
    }, [onClose]);

    const Body = onSubmit ? 'form' : 'div';
    const bodyProps = onSubmit
        ? { onSubmit: event => { event.preventDefault(); onSubmit(event); }, className: 'modal-content', noValidate: true }
        : { className: 'modal-content' };

    return createPortal(
        <>
            <div className="modal d-block" tabIndex="-1" role="dialog" aria-modal="true" onMouseDown={event => {
                if (event.target === event.currentTarget) onClose();
            }}>
                <div className={`modal-dialog modal-dialog-centered modal-dialog-scrollable${size ? ` modal-${size}` : ''}`}>
                    <Body {...bodyProps}>
                        <div className="modal-header">
                            <h5 className="modal-title">{typeof title === 'string' ? t(title) : title}</h5>
                            <button type="button" className="btn-close" aria-label={t('Tutup')} onClick={onClose} />
                        </div>
                        <div className="modal-body">{children}</div>
                        {footer && <div className="modal-footer">{footer}</div>}
                    </Body>
                </div>
            </div>
            <div className="modal-backdrop show" />
        </>,
        document.body
    );
}
