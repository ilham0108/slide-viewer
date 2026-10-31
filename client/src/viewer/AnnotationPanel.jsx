import { useEffect, useRef } from 'react';
import { formatDate } from '../utils/format';
import { TYPE_INFO, annotationTitle } from './annotations';
import { t } from '../i18n';

function AuthorLine({ annotation }) {
    if (!annotation.author && !annotation.createdAt) return null;
    return (
        <span className="ann-item-meta">
            {annotation.author && (
                <>
                    {annotation.author}
                    {annotation.authorType === 'guest' && <span className="ann-guest">{t('tamu')}</span>}
                </>
            )}
            {annotation.author && annotation.createdAt && ' · '}
            {annotation.createdAt && formatDate(annotation.createdAt, true)}
        </span>
    );
}

/**
 * Side panel listing a slide's annotations. Clicking an item flies the viewer to it; in
 * edit mode the selected item shows fields for its name and description.
 */
export default function AnnotationPanel({
    annotations,
    selectedId,
    editable,
    dirty,
    saving,
    // Returns a ruler's length as text, e.g. "85.3 µm".
    measure,
    onSelect,
    onUpdate,
    onDelete,
    onSave,
    onClose,
}) {
    const listRef = useRef(null);

    // Keep the selected item in view (e.g. after drawing a new shape).
    useEffect(() => {
        if (!selectedId) return;
        listRef.current?.querySelector(`[data-ann-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [selectedId]);

    return (
        <aside className="ann-panel" aria-label={t('Daftar anotasi')}>
            <header className="ann-panel-header">
                <span className="ann-panel-title">
                    {t('Anotasi')} <span className="section-count">{annotations.length}</span>
                </span>
                <button type="button" className="icon-btn" aria-label={t('Tutup daftar anotasi')} onClick={onClose}>
                    <i className="fas fa-times" aria-hidden="true" />
                </button>
            </header>

            <div className="ann-list" ref={listRef}>
                {!annotations.length && (
                    <p className="ann-empty">
                        {editable ? t('Belum ada anotasi. Pilih alat di kiri lalu gambar di slide.') : t('Slide ini belum memiliki anotasi.')}
                    </p>
                )}
                {annotations.map((annotation, index) => {
                    const selected = annotation.id === selectedId;
                    const type = TYPE_INFO[annotation.type];
                    return (
                        <div key={annotation.id} data-ann-id={annotation.id} className={`ann-item${selected ? ' selected' : ''}`}>
                            <button type="button" className="ann-item-main" onClick={() => onSelect(annotation.id)}
                                title={t('Tampilkan lokasi anotasi')}>
                                <span className="ann-item-icon" style={{ color: annotation.color, borderColor: annotation.color }}>
                                    <i className={type?.icon || 'fas fa-map-marker-alt'} aria-hidden="true" />
                                </span>
                                <span className="ann-item-text">
                                    <span className="ann-item-title">{annotationTitle(annotation, index)}</span>
                                    {annotation.type === 'ruler' && measure && <span className="ann-item-measure">{measure(annotation)}</span>}
                                    {annotation.description && !selected && <span className="ann-item-desc">{annotation.description}</span>}
                                    <AuthorLine annotation={annotation} />
                                </span>
                                <i className="fas fa-crosshairs ann-item-go" aria-hidden="true" />
                            </button>

                            {selected && editable && (
                                <div className="ann-item-edit">
                                    <label className="form-label" htmlFor={`ann-label-${annotation.id}`}>{t('Nama')}</label>
                                    <input id={`ann-label-${annotation.id}`} className="form-control form-control-sm" maxLength={200}
                                        placeholder={annotationTitle({ ...annotation, label: null }, index)}
                                        value={annotation.label || ''}
                                        onChange={event => onUpdate(annotation.id, { label: event.target.value })} />
                                    <label className="form-label mt-2" htmlFor={`ann-desc-${annotation.id}`}>{t('Deskripsi')}</label>
                                    <textarea id={`ann-desc-${annotation.id}`} className="form-control form-control-sm" rows={3} maxLength={2000}
                                        placeholder={t('Temuan, catatan, atau pertanyaan untuk area ini')}
                                        value={annotation.description || ''}
                                        onChange={event => onUpdate(annotation.id, { description: event.target.value })} />
                                    <div className="ann-item-actions">
                                        <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => onDelete(annotation.id)}>
                                            <i className="far fa-trash-alt me-1" aria-hidden="true" />{t('Hapus')}
                                        </button>
                                    </div>
                                </div>
                            )}
                            {selected && !editable && annotation.description && (
                                <p className="ann-item-desc-full">{annotation.description}</p>
                            )}
                        </div>
                    );
                })}
            </div>

            {editable && (
                <footer className="ann-panel-footer">
                    <span className={`ann-save-state${dirty ? ' is-dirty' : ''}`}>
                        {dirty ? t('Ada perubahan belum disimpan') : t('Semua perubahan tersimpan')}
                    </span>
                    <button type="button" className="btn btn-sm btn-primary" onClick={onSave} disabled={!dirty || saving}>
                        {saving ? t('Menyimpan…') : t('Simpan')}
                    </button>
                </footer>
            )}
        </aside>
    );
}
