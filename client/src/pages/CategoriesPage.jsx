import { useCallback, useEffect, useState } from 'react';
import { api, notifyCasesChanged } from '../api';
import { useAuth } from '../auth/AuthContext';
import Modal from '../components/Modal';
import ShareDialog from '../components/ShareDialog';
import { EmptyState, LoadingState, PageHeader } from '../components/States';
import { useToast } from '../components/Toast';
import { t } from '../i18n';

const PRESET_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#4b5563'];

function CategoryModal({ initial, onClose, onSaved }) {
    const toast = useToast();
    const [form, setForm] = useState({
        name: initial?.name || '',
        description: initial?.description || '',
        color: initial?.color || PRESET_COLORS[0],
    });
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const submit = async () => {
        setSaving(true);
        setError('');
        try {
            if (initial) await api(`/categories/${initial.id}`, { method: 'PUT', body: form });
            else await api('/categories', { method: 'POST', body: form });
            toast(initial ? 'Kategori diperbarui.' : 'Kategori dibuat.', 'success');
            notifyCasesChanged();
            onSaved();
        } catch (saveError) {
            setError(saveError.message);
            setSaving(false);
        }
    };

    return (
        <Modal title={initial ? t('Ubah kategori') : t('Kategori baru')} onClose={onClose} onSubmit={submit} footer={(
            <>
                <button type="button" className="btn btn-light" onClick={onClose}>{t('Batal')}</button>
                <button type="submit" className="btn btn-primary" disabled={saving || !form.name.trim()}>{t('Simpan')}</button>
            </>
        )}>
            {error && <div className="alert alert-danger py-2">{error}</div>}
            <div className="mb-3">
                <label className="form-label" htmlFor="categoryName">{t('Nama')}{' '}<span className="text-danger">*</span></label>
                <input id="categoryName" className="form-control" maxLength={100} autoFocus value={form.name}
                    placeholder={t('mis. Histopatologi, Sitologi, IHC')}
                    onChange={event => setForm({ ...form, name: event.target.value })} />
            </div>
            <div className="mb-3">
                <label className="form-label" htmlFor="categoryDescription">{t('Deskripsi')}</label>
                <input id="categoryDescription" className="form-control" maxLength={255} value={form.description}
                    onChange={event => setForm({ ...form, description: event.target.value })} />
            </div>
            <label className="form-label d-block">{t('Warna')}</label>
            <div className="d-flex align-items-center gap-2 flex-wrap">
                {PRESET_COLORS.map(color => (
                    <button key={color} type="button" className={`swatch${form.color === color ? ' active' : ''}`}
                        style={{ '--swatch': color }} aria-label={color} onClick={() => setForm({ ...form, color })} />
                ))}
                <input type="color" className="form-control form-control-color" value={form.color} aria-label={t('Warna lain')}
                    onChange={event => setForm({ ...form, color: event.target.value })} />
            </div>
        </Modal>
    );
}

export default function CategoriesPage() {
    const toast = useToast();
    const [categories, setCategories] = useState(null);
    const [editing, setEditing] = useState(null);
    const [sharing, setSharing] = useState(null);
    const { can } = useAuth();

    const load = useCallback(async () => {
        try {
            setCategories((await api('/categories')).categories);
        } catch (error) {
            toast(error.message, 'error');
            setCategories([]);
        }
    }, [toast]);

    useEffect(() => {
        load();
    }, [load]);

    const remove = async category => {
        if (!window.confirm(t('Hapus kategori "{name}"?', { name: category.name }))) return;
        try {
            await api(`/categories/${category.id}`, { method: 'DELETE' });
            toast('Kategori dihapus.', 'success');
            notifyCasesChanged();
            load();
        } catch (error) {
            toast(error.message, 'error');
        }
    };

    return (
        <div className="page">
            <PageHeader
                title={t('Kategori')}
                subtitle={t('Kelompokkan case berdasarkan jenis pemeriksaan.')}
                actions={(
                    <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>
                        <i className="fas fa-plus me-1" aria-hidden="true" />{' '}{t('Kategori baru')}
                    </button>
                )}
            />
            {!categories ? <LoadingState /> : !categories.length ? (
                <EmptyState icon="fa-tags" message={t('Belum ada kategori.')} />
            ) : (
                <div className="panel">
                    <div className="table-responsive">
                        <table className="data-table">
                            <thead>
                                <tr><th>{t('Nama')}</th><th>{t('Deskripsi')}</th><th className="text-end">{t('Case')}</th><th aria-label={t('Aksi')} /></tr>
                            </thead>
                            <tbody>
                                {categories.map(category => (
                                    <tr key={category.id}>
                                        <td className="fw-semibold">
                                            <span className="category-dot me-2" style={{ background: category.color }} />{category.name}
                                        </td>
                                        <td className="text-muted">{category.description || '—'}</td>
                                        <td className="text-end">{category.caseCount}</td>
                                        <td className="text-end text-nowrap">
                                            {can('shares.create') && (
                                                <button type="button" className="btn btn-sm btn-light me-1" title={t('Bagikan')} onClick={() => setSharing(category)}>
                                                    <i className="fas fa-share-alt" aria-hidden="true" /><span className="visually-hidden">{t('Bagikan')}</span>
                                                </button>
                                            )}
                                            <button type="button" className="btn btn-sm btn-light me-1" onClick={() => setEditing(category)}>
                                                <i className="fas fa-pen" aria-hidden="true" /><span className="visually-hidden">{t('Ubah')}</span>
                                            </button>
                                            <button type="button" className="btn btn-sm btn-light text-danger" onClick={() => remove(category)}
                                                disabled={category.caseCount > 0} title={category.caseCount > 0 ? t('Masih dipakai oleh case') : t('Hapus')}>
                                                <i className="fas fa-trash-alt" aria-hidden="true" /><span className="visually-hidden">{t('Hapus')}</span>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            {sharing && (
                <ShareDialog target={{ type: 'category', resourceId: sharing.id, label: sharing.name }} onClose={() => setSharing(null)} />
            )}
            {editing && (
                <CategoryModal initial={editing.id ? editing : null} onClose={() => setEditing(null)}
                    onSaved={() => { setEditing(null); load(); }} />
            )}
        </div>
    );
}
