import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SLIDES_CHANGED_EVENT, api } from '../api';
import UploadDialog from '../components/UploadDialog';
import { useAuth } from '../auth/AuthContext';
import { useSlideSelection } from '../components/CompareBar';
import ShareDialog from '../components/ShareDialog';
import SlideCard from '../components/SlideCard';
import { useSlideActions } from '../components/SlideActions';
import { EmptyState, LoadingState, PageHeader } from '../components/States';
import { useToast } from '../components/Toast';
import Pagination from '../components/Pagination';
import { caseLabel } from '../utils/format';
import { t } from '../i18n';

/**
 * Slide gallery (start page). Filters come from the URL so the sidebar can link to them:
 * ?category=ID|none narrows to the cases of one category, ?case=ID|none to one case or to
 * slides without a case.
 */
export default function LibraryPage() {
    const { can } = useAuth();
    const toast = useToast();
    const [params, setParams] = useSearchParams();
    // One page of slides: { slides, total, page, pageSize }.
    const [result, setResult] = useState(null);
    const [cases, setCases] = useState([]);
    const [categories, setCategories] = useState([]);
    const [search, setSearch] = useState(() => params.get('q') || '');
    const selection = useSlideSelection();
    const [sharing, setSharing] = useState(false);
    const [uploading, setUploading] = useState(false);
    const categoryFilter = params.get('category') || '';
    const caseFilter = params.get('case') || '';
    // Page and search live in the URL, so Back and shared links return to the same page.
    const page = Math.max(1, Number(params.get('page')) || 1);
    const query = params.get('q') || '';

    const updateParams = useCallback(changes => {
        setParams(current => {
            const next = new URLSearchParams(current);
            for (const [key, value] of Object.entries(changes)) {
                if (value === null || value === '' || (key === 'page' && value === 1)) next.delete(key);
                else next.set(key, String(value));
            }
            return next;
        });
    }, [setParams]);

    const load = useCallback(async () => {
        const request = new URLSearchParams({ page: String(page) });
        if (query) request.set('search', query);
        if (caseFilter && caseFilter !== 'none') request.set('caseId', caseFilter);
        else {
            if (categoryFilter) request.set('categoryId', categoryFilter);
            // case=none: inside a category, the slides placed there directly; otherwise unsorted slides.
            if (caseFilter === 'none') request.set('unassigned', '1');
        }
        try {
            const data = await api(`/slides?${request}`);
            // Deleting the last slides of the last page leaves it empty: show the one before.
            if (!data.slides.length && page > 1) {
                updateParams({ page: Math.max(1, Math.ceil(data.total / data.pageSize)) });
                return;
            }
            setResult(data);
        } catch (error) {
            toast(error.message, 'error');
            setResult({ slides: [], total: 0, page: 1, pageSize: 48 });
        }
    }, [caseFilter, categoryFilter, page, query, toast, updateParams]);

    useEffect(() => {
        setResult(null);
        load();
    }, [load]);

    // The URL changed elsewhere (e.g. a sidebar link without ?q=): the box follows it.
    useEffect(() => {
        setSearch(current => (current.trim() === query ? current : query));
    }, [query]);

    // Search on the server after a short pause in typing, from the first page.
    useEffect(() => {
        const term = search.trim();
        if (term === query) return undefined;
        const timer = setTimeout(() => updateParams({ q: term, page: 1 }), 300);
        return () => clearTimeout(timer);
    }, [search, query, updateParams]);

    // Uploads (app-wide queue) and bulk deletes (selection bar) change the gallery.
    useEffect(() => {
        window.addEventListener(SLIDES_CHANGED_EVENT, load);
        return () => window.removeEventListener(SLIDES_CHANGED_EVENT, load);
    }, [load]);

    useEffect(() => {
        if (can('cases.view')) api('/cases').then(data => setCases(data.cases)).catch(() => {});
        api('/categories').then(data => setCategories(data.categories)).catch(() => {});
    }, [can]);

    const { actionsFor, modal } = useSlideActions({ onChanged: load });

    const visible = result?.slides ?? null;

    const category = categories.find(item => String(item.id) === categoryFilter);
    // Inside a category, the case filter only offers that category's cases.
    const caseOptions = categoryFilter
        ? cases.filter(item => (categoryFilter === 'none' ? !item.category : String(item.category?.id) === categoryFilter))
        : cases;

    let title = 'Semua slide';
    let subtitle = 'Seluruh slide yang siap dilihat, dari semua case.';
    if (categoryFilter && categoryFilter !== 'none' && caseFilter === 'none') {
        title = category?.name || 'Kategori';
        subtitle = t('Slide yang langsung dimasukkan ke kategori ini, tanpa case.');
    } else if (categoryFilter === 'none') {
        title = 'Tanpa kategori';
        subtitle = 'Slide dari case yang belum memiliki kategori.';
    } else if (categoryFilter) {
        title = category?.name || 'Kategori';
        subtitle = category?.description || t('Slide dari {n} case di kategori ini.', { n: caseOptions.length });
    } else if (caseFilter === 'none') {
        title = 'Belum dikelompokkan';
        subtitle = 'Slide yang belum masuk case maupun kategori. Pindahkan lewat menu ⋮ pada kartu slide.';
    }

    const setCaseFilter = value => updateParams({ case: value || null, page: 1 });

    return (
        <div className="page">
            <PageHeader
                eyebrow={category && <i className="fas fa-folder-open page-title-icon" style={{ color: category.color }} aria-hidden="true" />}
                title={title}
                subtitle={subtitle}
                actions={(
                    <>
                        {can('slides.upload') && (
                            <button type="button" className="btn btn-primary" onClick={() => setUploading(true)}>
                                <i className="fas fa-cloud-upload-alt me-2" aria-hidden="true" />{t('Unggah slide')}
                            </button>
                        )}
                        {category && can('shares.create') && (
                            <button type="button" className="btn btn-outline-secondary" onClick={() => setSharing(true)}>
                                <i className="fas fa-share-alt me-2" aria-hidden="true" />{t('Bagikan kategori')}
                            </button>
                        )}
                    </>
                )}
            />

            <div className="toolbar">
                <div className="search-field">
                    <i className="fas fa-search" aria-hidden="true" />
                    <input className="form-control" placeholder={t('Cari nama slide atau nomor case')} value={search}
                        onChange={event => setSearch(event.target.value)} aria-label={t('Cari slide')} />
                </div>
                {can('cases.view') && (caseFilter !== 'none' || (categoryFilter && categoryFilter !== 'none')) && (
                    <select className="form-select toolbar-select" value={caseFilter} aria-label={t('Filter case')}
                        onChange={event => setCaseFilter(event.target.value)}>
                        <option value="">{categoryFilter ? t('Semua case di kategori ini') : t('Semua case')}</option>
                        {caseOptions.map(item => <option key={item.id} value={item.id}>{caseLabel(item)}</option>)}
                        {categoryFilter && categoryFilter !== 'none' && <option value="none">{t('Slide tanpa case')}</option>}
                    </select>
                )}
                {result && <span className="toolbar-count">{t('{n} slide', { n: result.total })}</span>}
            </div>

            {!visible ? <LoadingState message={t('Memuat daftar slide…')} /> : !visible.length ? (
                <EmptyState
                    icon="fa-images"
                    message={query ? 'Tidak ada slide yang cocok' : categoryFilter || caseFilter ? t('Belum ada slide di sini') : t('Belum ada slide')}
                    description={query ? t('Ubah kata kunci pencarian.') : t('Unggah slide lewat tombol Unggah slide.')}
                />
            ) : (
                <>
                    <div className="slide-grid">
                        {visible.map((slide, index) => (
                            <SlideCard key={slide.id} slide={slide} index={index} showCase actions={actionsFor(slide)}
                                selected={selection.isSelected(slide.id)}
                                onToggleSelect={selection.toggle} />
                        ))}
                    </div>
                    <Pagination page={result.page} pageSize={result.pageSize} total={result.total}
                        onChange={value => updateParams({ page: value })} />
                </>
            )}

            {sharing && category && (
                <ShareDialog target={{ type: 'category', resourceId: category.id, label: category.name }}
                    onClose={() => setSharing(false)} />
            )}
            {uploading && (
                <UploadDialog
                    // Start from what is on screen: the filtered case, else the open category.
                    initialTarget={caseFilter && caseFilter !== 'none'
                        ? { type: 'case', id: caseFilter }
                        : category ? { type: 'category', id: category.id } : undefined}
                    onClose={() => setUploading(false)}
                />
            )}
            {modal}
        </div>
    );
}
