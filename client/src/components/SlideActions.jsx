import { useEffect, useState } from 'react';
import { api, notifyCasesChanged } from '../api';
import { useAuth } from '../auth/AuthContext';
import { caseLabel, displayName } from '../utils/format';
import Modal from './Modal';
import ShareDialog from './ShareDialog';
import { useToast } from './Toast';
import { t } from '../i18n';

function MoveSlideModal({ slide, onClose, onMoved }) {
    const toast = useToast();
    const [cases, setCases] = useState(null);
    const [categories, setCategories] = useState(null);
    const [caseId, setCaseId] = useState(slide.case?.id ? String(slide.case.id) : '');
    // Only used while the slide is in no case; otherwise the case's category applies.
    const [categoryId, setCategoryId] = useState(!slide.case && slide.category ? String(slide.category.id) : '');
    const [name, setName] = useState(slide.originalName);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api('/cases').then(data => setCases(data.cases)).catch(error => toast(error.message, 'error'));
        api('/categories').then(data => setCategories(data.categories)).catch(error => toast(error.message, 'error'));
    }, [toast]);

    const chosenCase = cases?.find(item => String(item.id) === caseId);

    const submit = async () => {
        setSaving(true);
        try {
            const data = await api(`/slides/${slide.id}`, {
                method: 'PATCH',
                body: {
                    caseId: caseId ? Number(caseId) : null,
                    categoryId: !caseId && categoryId ? Number(categoryId) : null,
                    originalName: name,
                },
            });
            toast('Slide diperbarui.', 'success');
            onMoved(data.slide);
        } catch (error) {
            toast(error.message, 'error');
            setSaving(false);
        }
    };

    return (
        <Modal title={t('Ubah / pindahkan slide')} onClose={onClose} onSubmit={submit} footer={(
            <>
                <button type="button" className="btn btn-light" onClick={onClose}>{t('Batal')}</button>
                <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>{t('Simpan')}</button>
            </>
        )}>
            <div className="mb-3">
                <label className="form-label" htmlFor="slideName">{t('Nama slide')}</label>
                <input id="slideName" className="form-control" maxLength={255} value={name} onChange={event => setName(event.target.value)} />
            </div>
            <label className="form-label" htmlFor="slideCase">{t('Case')}</label>
            <select id="slideCase" className="form-select" value={caseId} disabled={!cases} onChange={event => setCaseId(event.target.value)}>
                <option value="">{t('— Tanpa case —')}</option>
                {cases?.map(item => (
                    <option key={item.id} value={item.id}>{caseLabel(item)}</option>
                ))}
            </select>

            <label className="form-label mt-3" htmlFor="slideCategory">{t('Kategori slide')}</label>
            {caseId ? (
                <div className="form-control-plaintext slide-category-note">
                    <i className="fas fa-info-circle me-2" aria-hidden="true" />
                    {chosenCase?.category
                        ? t('Mengikuti kategori case: {name}', { name: chosenCase.category.name })
                        : t('Mengikuti case (case ini belum memiliki kategori).')}
                </div>
            ) : (
                <>
                    <select id="slideCategory" className="form-select" value={categoryId} disabled={!categories}
                        onChange={event => setCategoryId(event.target.value)}>
                        <option value="">{t('— Tanpa kategori —')}</option>
                        {categories?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <div className="form-text">{t('Slide tanpa case dapat langsung dimasukkan ke kategori.')}</div>
                </>
            )}
        </Modal>
    );
}

/**
 * Builds the per-slide menu (edit/move, delete) according to the user's permissions.
 * Returns the actions for SlideCard plus the modal element to render.
 */
export function useSlideActions({ onChanged }) {
    const { can } = useAuth();
    const toast = useToast();
    const [moving, setMoving] = useState(null);
    const [sharing, setSharing] = useState(null);

    const remove = async slide => {
        if (!window.confirm(t('Hapus slide "{name}" beserta seluruh anotasinya? Tindakan ini tidak dapat dibatalkan.', { name: displayName(slide) }))) return;
        try {
            await api(`/slides/${slide.id}`, { method: 'DELETE' });
            toast('Slide dihapus.', 'success');
            notifyCasesChanged();
            onChanged();
        } catch (error) {
            toast(error.message, 'error');
        }
    };

    const recheck = async slide => {
        try {
            await api(`/slides/${slide.id}/retry`, { method: 'POST' });
            toast('Slide siap dilihat.', 'success');
            notifyCasesChanged();
        } catch (error) {
            toast(error.message, 'error');
        }
        onChanged();
    };

    const actionsFor = slide => {
        const actions = [];
        if (slide.status === 'failed' && can('slides.upload')) {
            actions.push({ label: 'Periksa ulang', icon: 'fa-redo', onClick: recheck });
        }
        if (slide.status === 'ready' && can('shares.create')) {
            actions.push({ label: 'Bagikan link', icon: 'fa-share-alt', onClick: setSharing });
        }
        if (can('cases.update')) actions.push({ label: 'Ubah / pindahkan', icon: 'fa-exchange-alt', onClick: setMoving });
        if (can('slides.delete') && slide.status !== 'processing') {
            actions.push({ label: 'Hapus', icon: 'fa-trash-alt', onClick: remove, danger: true });
        }
        return actions;
    };

    const modal = (
        <>
            {moving && (
                <MoveSlideModal slide={moving} onClose={() => setMoving(null)}
                    onMoved={() => { setMoving(null); notifyCasesChanged(); onChanged(); }} />
            )}
            {sharing && (
                <ShareDialog target={{ type: 'slide', resourceId: sharing.id, label: displayName(sharing) }}
                    onClose={() => setSharing(null)} />
            )}
        </>
    );

    return { actionsFor, modal };
}
