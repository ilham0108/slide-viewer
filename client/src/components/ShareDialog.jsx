import { useState } from 'react';
import { api } from '../api';
import { formatDate } from '../utils/format';
import Modal from './Modal';
import { useToast } from './Toast';
import { t } from '../i18n';

const EXPIRY_OPTIONS = [
    { value: '1', label: '1 hari' },
    { value: '7', label: '7 hari' },
    { value: '30', label: '30 hari' },
    { value: '90', label: '90 hari' },
    { value: '', label: 'Tanpa batas waktu' },
];

const TYPE_LABELS = {
    slide: 'slide',
    case: 'case',
    category: 'kategori',
    compare: 'tampilan perbandingan',
    slides: 'slide pilihan',
    cases: 'case pilihan',
};

export function shareUrl(share) {
    return `${window.location.origin}${share.url}`;
}

export async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // Clipboard API needs HTTPS or localhost; fall back to a temporary text field.
        const field = document.createElement('textarea');
        field.value = text;
        document.body.appendChild(field);
        field.select();
        const ok = document.execCommand('copy');
        field.remove();
        return ok;
    }
}

/**
 * Creates a public, read-only link. `target` describes what is shared:
 *   { type: 'slide', resourceId, label, getViewState?: () => view }
 *   { type: 'case' | 'category', resourceId, label }
 *   { type: 'compare', label, getViewState: () => ({ slides, panels, sync }) }
 */
export default function ShareDialog({ target, onClose }) {
    const toast = useToast();
    const [form, setForm] = useState({
        title: '',
        expiresInDays: '7',
        usePassword: false,
        password: '',
        hideClinical: true,
        showAnnotations: true,
        allowAnnotationEdit: false,
        includeView: Boolean(target.getViewState) && target.type === 'slide',
    });
    const [created, setCreated] = useState(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const set = field => event => setForm({ ...form, [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value });

    const hasClinicalInfo = target.type === 'case' || target.type === 'category' || target.type === 'cases';

    const submit = async () => {
        setError('');
        if (form.usePassword && form.password.length < 4) {
            setError('Password minimal 4 karakter.');
            return;
        }
        setSaving(true);
        try {
            let viewState;
            if (target.type === 'slides') viewState = { slides: target.ids };
            else if (target.type === 'cases') viewState = { cases: target.ids };
            else if (target.type === 'compare' || form.includeView) viewState = target.getViewState?.();
            const data = await api('/shares', {
                method: 'POST',
                body: {
                    type: target.type,
                    resourceId: target.resourceId,
                    title: form.title.trim() || undefined,
                    viewState: viewState || undefined,
                    expiresInDays: form.expiresInDays ? Number(form.expiresInDays) : null,
                    password: form.usePassword ? form.password : undefined,
                    hideClinical: hasClinicalInfo && form.hideClinical,
                    showAnnotations: form.showAnnotations || form.allowAnnotationEdit,
                    allowAnnotationEdit: form.allowAnnotationEdit,
                },
            });
            setCreated(data.share);
        } catch (saveError) {
            setError(saveError.message);
        } finally {
            setSaving(false);
        }
    };

    if (created) {
        const url = shareUrl(created);
        return (
            <Modal title={t('Link berhasil dibuat')} onClose={onClose} footer={(
                <>
                    <a className="btn btn-outline-secondary" href={url} target="_blank" rel="noreferrer">
                        <i className="fas fa-external-link-alt me-2" aria-hidden="true" />{t('Buka')}
                    </a>
                    <button type="button" className="btn btn-primary" onClick={onClose}>{t('Selesai')}</button>
                </>
            )}>
                <p className="text-muted-2 mb-2">{t('Siapa pun yang memiliki link ini dapat melihat {what} tanpa login.', { what: t(TYPE_LABELS[created.type]) })}</p>
                <div className="share-link-box">
                    <input className="form-control" readOnly value={url} onFocus={event => event.target.select()} />
                    <button type="button" className="btn btn-primary" onClick={async () => {
                        toast(await copyText(url) ? 'Link disalin.' : 'Gagal menyalin link.', 'success');
                    }}>
                        <i className="far fa-copy me-2" aria-hidden="true" />{t('Salin')}
                    </button>
                </div>
                <ul className="share-summary">
                    <li><i className="far fa-clock" aria-hidden="true" />{created.expiresAt ? t('Berlaku sampai {date}', { date: formatDate(created.expiresAt, true) }) : t('Tanpa batas waktu')}</li>
                    <li><i className="fas fa-lock" aria-hidden="true" />{created.hasPassword ? t('Dilindungi password (sampaikan password terpisah dari link)') : t('Tanpa password')}</li>
                    {hasClinicalInfo && <li><i className="fas fa-notes-medical" aria-hidden="true" />{created.hideClinical ? t('Catatan klinis disembunyikan') : t('Catatan klinis ditampilkan')}</li>}
                    <li><i className="fas fa-draw-polygon" aria-hidden="true" />
                        {created.allowAnnotationEdit ? t('Penerima dapat membuat dan mengedit anotasi')
                            : created.showAnnotations ? t('Anotasi tersimpan ikut ditampilkan (hanya-lihat)') : t('Anotasi tidak ditampilkan')}
                    </li>
                </ul>
                <p className="small text-muted-2 mb-0">{t('Link dapat dicabut kapan saja dari menu')}{' '}<strong>{t('Link Berbagi')}</strong>{' '}{t('di navigasi atas.')}</p>
            </Modal>
        );
    }

    return (
        <Modal title={t('Bagikan {what}', { what: t(TYPE_LABELS[target.type]) })} onClose={onClose} onSubmit={submit} footer={(
            <>
                <button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('Batal')}</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                    <i className="fas fa-link me-2" aria-hidden="true" />{saving ? t('Membuat…') : t('Buat link')}
                </button>
            </>
        )}>
            <div className="share-target">
                <i className={`fas ${{ slide: 'fa-image', case: 'fa-file-medical', category: 'fa-folder', compare: 'fa-columns', slides: 'fa-images', cases: 'fa-copy' }[target.type]}`} aria-hidden="true" />
                <span>{target.label}</span>
            </div>
            {error && <div className="alert alert-danger py-2">{error}</div>}

            <div className="mb-3">
                <label className="form-label" htmlFor="shareTitle">{t('Judul untuk penerima')}</label>
                <input id="shareTitle" className="form-control" maxLength={255} placeholder={target.label} value={form.title} onChange={set('title')} />
                <div className="form-text">{t('Kosongkan untuk memakai nama {what}.', { what: t(TYPE_LABELS[target.type]) })}</div>
            </div>

            <div className="mb-3">
                <label className="form-label" htmlFor="shareExpiry">{t('Masa berlaku')}</label>
                <select id="shareExpiry" className="form-select" value={form.expiresInDays} onChange={set('expiresInDays')}>
                    {EXPIRY_OPTIONS.map(option => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
                </select>
            </div>

            <div className="share-options">
                <div className="form-check form-switch">
                    <input id="sharePasswordToggle" type="checkbox" className="form-check-input" checked={form.usePassword} onChange={set('usePassword')} />
                    <label className="form-check-label" htmlFor="sharePasswordToggle">{t('Lindungi dengan password')}</label>
                </div>
                {form.usePassword && (
                    <input type="text" className="form-control mt-2 mb-1" placeholder={t('Minimal 4 karakter')} autoComplete="off" maxLength={128}
                        value={form.password} onChange={set('password')} aria-label={t('Password link')} />
                )}

                {target.type === 'slide' && target.getViewState && (
                    <div className="form-check form-switch">
                        <input id="shareView" type="checkbox" className="form-check-input" checked={form.includeView} onChange={set('includeView')} />
                        <label className="form-check-label" htmlFor="shareView">{t('Buka di posisi, zoom, dan rotasi saat ini')}</label>
                    </div>
                )}
                {target.type === 'compare' && (
                    <p className="small text-muted-2 mb-2">{t('Tata letak panel, posisi tiap panel, dan status sinkron ikut dibagikan.')}</p>
                )}

                <div className="form-check form-switch">
                    <input id="shareAnnotations" type="checkbox" className="form-check-input"
                        checked={form.showAnnotations || form.allowAnnotationEdit} disabled={form.allowAnnotationEdit}
                        onChange={set('showAnnotations')} />
                    <label className="form-check-label" htmlFor="shareAnnotations">{t('Tampilkan anotasi tersimpan')}</label>
                </div>
                <div className="form-check form-switch">
                    <input id="shareAnnotationEdit" type="checkbox" className="form-check-input" checked={form.allowAnnotationEdit} onChange={set('allowAnnotationEdit')} />
                    <label className="form-check-label" htmlFor="shareAnnotationEdit">
                        {t('Izinkan penerima membuat dan mengedit anotasi')}
                    </label>
                    {form.allowAnnotationEdit && (
                        <div className="form-text">
                            {t('Penerima mengisi nama sebelum menganotasi, dan dapat menambah, mengubah, atau menghapus anotasi slide. Setiap anotasi mencatat nama pembuatnya.')}
                        </div>
                    )}
                </div>

                {hasClinicalInfo && (
                    <div className="form-check form-switch">
                        <input id="shareClinical" type="checkbox" className="form-check-input" checked={form.hideClinical} onChange={set('hideClinical')} />
                        <label className="form-check-label" htmlFor="shareClinical">{t('Sembunyikan catatan klinis')}</label>
                    </div>
                )}
            </div>

            <p className="small text-muted-2 mt-3 mb-0">
                <i className="fas fa-eye me-1" aria-hidden="true" />
                {form.allowAnnotationEdit
                    ? t('Penerima dapat melihat dan menganotasi; tidak dapat mengubah data case atau mengunggah slide.')
                    : t('Penerima hanya dapat melihat; tidak dapat mengubah, mengunggah, atau menyimpan anotasi.')}
                {(target.type === 'case' || target.type === 'category' || target.type === 'cases') && ` ${t('Slide yang ditambahkan nanti ke case tersebut ikut terlihat selama link aktif.')}`}
            </p>
        </Modal>
    );
}
