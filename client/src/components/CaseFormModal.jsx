import { useState } from 'react';
import { api, notifyCasesChanged } from '../api';
import { CASE_STATUSES } from '../utils/format';
import Modal from './Modal';
import { useToast } from './Toast';
import { t } from '../i18n';

export default function CaseFormModal({ initial, defaultCategoryId, categories, onClose, onSaved }) {
    const toast = useToast();
    const [form, setForm] = useState({
        caseNumber: initial?.caseNumber || '',
        title: initial?.title || '',
        categoryId: initial?.category?.id ? String(initial.category.id) : defaultCategoryId ? String(defaultCategoryId) : '',
        status: initial?.status || 'open',
        description: initial?.description || '',
    });
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const set = field => event => setForm(current => ({ ...current, [field]: event.target.value }));

    const submit = async () => {
        setSaving(true);
        setError('');
        try {
            const body = { ...form, categoryId: form.categoryId ? Number(form.categoryId) : null };
            const data = initial
                ? await api(`/cases/${initial.id}`, { method: 'PUT', body })
                : await api('/cases', { method: 'POST', body });
            toast(initial ? 'Case diperbarui.' : 'Case dibuat.', 'success');
            notifyCasesChanged();
            onSaved(data.case);
        } catch (saveError) {
            setError(saveError.message);
            setSaving(false);
        }
    };

    return (
        <Modal title={initial ? t('Ubah case') : t('Case baru')} onClose={onClose} onSubmit={submit} size="lg" footer={(
            <>
                <button type="button" className="btn btn-light" onClick={onClose}>{t('Batal')}</button>
                <button type="submit" className="btn btn-primary" disabled={saving || !form.caseNumber.trim() || !form.title.trim()}>
                    {saving ? t('Menyimpan…') : t('Simpan')}
                </button>
            </>
        )}>
            {error && <div className="alert alert-danger py-2">{error}</div>}
            <div className="row g-3">
                <div className="col-md-4">
                    <label className="form-label" htmlFor="caseNumber">{t('Nomor case')}{' '}<span className="text-danger">*</span></label>
                    <input id="caseNumber" className="form-control" maxLength={64} autoFocus value={form.caseNumber} onChange={set('caseNumber')}
                        placeholder={t('mis. HP-2026-0012')} />
                </div>
                <div className="col-md-8">
                    <label className="form-label" htmlFor="caseTitle">{t('Judul')}{' '}<span className="text-danger">*</span></label>
                    <input id="caseTitle" className="form-control" maxLength={255} value={form.title} onChange={set('title')} />
                </div>
                <div className="col-md-6">
                    <label className="form-label" htmlFor="caseCategory">{t('Kategori')}</label>
                    <select id="caseCategory" className="form-select" value={form.categoryId} onChange={set('categoryId')}>
                        <option value="">{t('— Tanpa kategori —')}</option>
                        {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                </div>
                <div className="col-md-6">
                    <label className="form-label" htmlFor="caseStatus">{t('Status')}</label>
                    <select id="caseStatus" className="form-select" value={form.status} onChange={set('status')}>
                        {Object.entries(CASE_STATUSES).map(([value, { label }]) => <option key={value} value={value}>{t(label)}</option>)}
                    </select>
                </div>
                <div className="col-12">
                    <label className="form-label" htmlFor="caseDescription">{t('Deskripsi / catatan klinis')}</label>
                    <textarea id="caseDescription" className="form-control" rows={4} maxLength={5000} value={form.description}
                        onChange={set('description')} />
                </div>
            </div>
        </Modal>
    );
}
