import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, notifyCasesChanged, notifySlidesChanged } from '../api';
import { useAuth } from '../auth/AuthContext';
import { displayName } from '../utils/format';
import ShareDialog from './ShareDialog';
import { useToast } from './Toast';
import { t } from '../i18n';

export const MAX_COMPARE = 4;
export const MAX_SELECTION = 100;
const STORAGE_KEY = 'slide-selection';

const SelectionContext = createContext(null);

function readStored() {
    try {
        const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
        return Array.isArray(value) ? value : [];
    } catch {
        return [];
    }
}

/**
 * Slides ticked in the gallery or on case pages. The selection survives navigation (and a
 * reload, through sessionStorage), so slides from different categories and cases can be
 * collected and then compared or shared together.
 */
export function SlideSelectionProvider({ children }) {
    const toast = useToast();
    const [selected, setSelected] = useState(readStored);

    useEffect(() => {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
        } catch {
            // Private mode or blocked storage: the selection just won't survive a reload.
        }
    }, [selected]);

    const toggle = useCallback(slide => {
        setSelected(current => {
            if (current.some(item => item.id === slide.id)) return current.filter(item => item.id !== slide.id);
            if (current.length >= MAX_SELECTION) {
                toast(t('Maksimal {n} slide dapat dipilih.', { n: MAX_SELECTION }), 'info');
                return current;
            }
            // Keep only what the bar needs, not the whole slide object.
            return [...current, { id: slide.id, name: slide.name, originalName: slide.originalName }];
        });
    }, [toast]);

    const value = useMemo(() => ({
        selected,
        toggle,
        clear: () => setSelected([]),
        remove: ids => setSelected(current => current.filter(item => !ids.includes(item.id))),
        isSelected: id => selected.some(item => item.id === id),
    }), [selected, toggle]);

    return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSlideSelection() {
    return useContext(SelectionContext);
}

/**
 * Floating bar shown while slides are selected: compare them (2–4), share them as one
 * link, or delete them.
 */
export default function CompareBar() {
    const navigate = useNavigate();
    const toast = useToast();
    const { can } = useAuth();
    const { selected, clear, remove } = useSlideSelection();
    const [sharing, setSharing] = useState(false);
    const [deleting, setDeleting] = useState(false);
    if (!selected.length && !sharing) return null;

    const deleteSelected = async () => {
        if (!window.confirm(t('Hapus {n} slide beserta file dan anotasinya? Tindakan ini tidak dapat dibatalkan.', { n: selected.length }))) return;
        setDeleting(true);
        try {
            const result = await api('/slides/delete', { method: 'POST', body: { ids: selected.map(slide => slide.id) } });
            toast(result.skipped.length
                ? t('{deleted} slide dihapus, {skipped} dilewati (sedang diproses atau sudah tidak ada).', { deleted: result.deleted.length, skipped: result.skipped.length })
                : t('{n} slide dihapus.', { n: result.deleted.length }), 'success');
            remove([...result.deleted, ...result.skipped]);
            notifyCasesChanged();
            notifySlidesChanged();
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            setDeleting(false);
        }
    };

    const canCompare = selected.length >= 2 && selected.length <= MAX_COMPARE;
    const compareHint = selected.length < 2 ? t('Pilih minimal 2 slide') : selected.length > MAX_COMPARE ? t('Maksimal {n} slide untuk dibandingkan', { n: MAX_COMPARE }) : undefined;

    return (
        <>
            {selected.length > 0 && (
                <div className="compare-bar">
                    <span className="compare-bar-text">
                        {t('{n} slide dipilih', { n: selected.length })}
                        <span className="d-none d-md-inline text-muted"> · {selected.slice(0, 3).map(displayName).join(', ')}{selected.length > 3 ? ', …' : ''}</span>
                    </span>
                    <button type="button" className="btn btn-sm btn-light" onClick={clear}>{t('Batal')}</button>
                    {can('slides.delete') && (
                        <button type="button" className="btn btn-sm btn-danger" onClick={deleteSelected} disabled={deleting}>
                            <i className="far fa-trash-alt me-1" aria-hidden="true" />{' '}{t('Hapus')}
                        </button>
                    )}
                    {can('shares.create') && (
                        <button type="button" className="btn btn-sm btn-light" onClick={() => setSharing(true)}>
                            <i className="fas fa-share-alt me-1" aria-hidden="true" />{' '}{t('Bagikan')}
                        </button>
                    )}
                    <button type="button" className="btn btn-sm btn-primary" disabled={!canCompare} title={compareHint}
                        onClick={() => navigate(`/compare?slides=${selected.map(slide => slide.id).join(',')}`)}>
                        <i className="fas fa-columns me-1" aria-hidden="true" />{' '}{t('Bandingkan')}
                    </button>
                </div>
            )}
            {sharing && (
                <ShareDialog
                    target={{
                        type: 'slides',
                        ids: selected.map(slide => slide.id),
                        label: `${t('{n} slide pilihan', { n: selected.length })}: ${selected.slice(0, 3).map(displayName).join(', ')}${selected.length > 3 ? ', …' : ''}`,
                    }}
                    onClose={() => setSharing(false)}
                />
            )}
        </>
    );
}
