import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { CategoryBadge, StatusBadge } from '../components/Badges';
import CaseFormModal from '../components/CaseFormModal';
import Pagination from '../components/Pagination';
import ShareDialog from '../components/ShareDialog';
import { EmptyState, LoadingState, PageHeader } from '../components/States';
import { useToast } from '../components/Toast';
import { CASE_STATUSES, formatDate } from '../utils/format';
import { t } from '../i18n';

export default function CasesPage() {
    const { can } = useAuth();
    const toast = useToast();
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const [cases, setCases] = useState(null);
    const [categories, setCategories] = useState([]);
    const [search, setSearch] = useState(params.get('search') || '');
    const [creating, setCreating] = useState(false);
    // Cases ticked for one shared link; kept while filters change so several categories can be combined.
    const [picked, setPicked] = useState([]);
    const [sharing, setSharing] = useState(false);
    const canPick = can('shares.create');
    const isPicked = id => picked.some(item => item.id === id);
    const togglePick = item => setPicked(current => (isPicked(item.id)
        ? current.filter(entry => entry.id !== item.id)
        : current.length >= 50 ? current : [...current, { id: item.id, caseNumber: item.caseNumber }]));
    const categoryId = params.get('categoryId') || '';
    const status = params.get('status') || '';
    const searchQuery = params.get('search') || '';
    const page = Math.max(1, Number(params.get('page')) || 1);
    const [paging, setPaging] = useState({ total: 0, pageSize: 50 });

    // A changed filter starts again from the first page.
    const setFilter = (key, value) => {
        const next = new URLSearchParams(params);
        if (value) next.set(key, value);
        else next.delete(key);
        next.delete('page');
        setParams(next, { replace: true });
    };

    const setPage = value => {
        const next = new URLSearchParams(params);
        if (value > 1) next.set('page', String(value));
        else next.delete('page');
        setParams(next);
    };

    const load = useCallback(async () => {
        const query = new URLSearchParams({ page: String(page) });
        if (categoryId) query.set('categoryId', categoryId);
        if (status) query.set('status', status);
        if (searchQuery) query.set('search', searchQuery);
        try {
            const data = await api(`/cases?${query}`);
            // A page past the end (e.g. after deleting its last case): show the last one.
            if (!data.cases.length && page > 1) {
                setPage(Math.max(1, Math.ceil(data.total / data.pageSize)));
                return;
            }
            setCases(data.cases);
            setPaging({ total: data.total, pageSize: data.pageSize });
        } catch (error) {
            toast(error.message, 'error');
            setCases([]);
        }
        // setPage only reads the current URL.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [categoryId, status, searchQuery, page, toast]);

    useEffect(() => {
        setCases(null);
        load();
    }, [load]);

    useEffect(() => {
        api('/categories').then(data => setCategories(data.categories)).catch(() => {});
    }, []);

    // Search as the user types, but only after a short pause.
    useEffect(() => {
        const timer = setTimeout(() => {
            if (search.trim() !== searchQuery) setFilter('search', search.trim());
        }, 300);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search]);

    const category = categories.find(item => String(item.id) === categoryId);
    const title = categoryId === 'none' ? 'Tanpa kategori' : category?.name || (categoryId ? 'Kategori' : 'Semua case');
    const subtitle = category?.description
        || (categoryId === 'none' ? 'Case yang belum dikelompokkan ke kategori mana pun.' : 'Daftar case patologi beserta slide-nya.');
    const filtered = Boolean(searchQuery || status);

    return (
        <div className="page">
            <PageHeader
                eyebrow={category && <span className="category-swatch" style={{ background: category.color }} />}
                title={title}
                subtitle={subtitle}
                actions={can('cases.create') && (
                    <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                        <i className="fas fa-plus me-2" aria-hidden="true" />{t('Case baru')}
                    </button>
                )}
            />

            <div className="toolbar">
                <div className="search-field">
                    <i className="fas fa-search" aria-hidden="true" />
                    <input className="form-control" placeholder={t('Cari nomor atau judul case')} value={search}
                        onChange={event => setSearch(event.target.value)} aria-label={t('Cari case')} />
                </div>
                <select className="form-select toolbar-select" value={categoryId} aria-label={t('Filter kategori')}
                    onChange={event => setFilter('categoryId', event.target.value)}>
                    <option value="">{t('Semua kategori')}</option>
                    {categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    <option value="none">{t('Tanpa kategori')}</option>
                </select>
                <div className="segmented" role="group" aria-label={t('Filter status')}>
                    <button type="button" className={!status ? 'active' : ''} onClick={() => setFilter('status', '')}>{t('Semua')}</button>
                    {Object.entries(CASE_STATUSES).map(([value, { label }]) => (
                        <button key={value} type="button" className={status === value ? 'active' : ''}
                            onClick={() => setFilter('status', value)}>{t(label)}</button>
                    ))}
                </div>
                {cases && <span className="toolbar-count">{t('{n} case', { n: paging.total })}</span>}
            </div>

            {!cases ? <LoadingState message={t('Memuat case…')} /> : !cases.length ? (
                <EmptyState
                    icon={filtered ? 'fa-search' : 'fa-folder-open'}
                    message={filtered ? 'Tidak ada case yang cocok' : categoryId ? t('Belum ada case di kategori ini') : t('Belum ada case')}
                    description={filtered
                        ? 'Ubah kata kunci atau filter status untuk melihat case lain.'
                        : 'Case mengelompokkan slide milik satu pemeriksaan. Buat case, lalu unggah slide ke dalamnya.'}
                >
                    {can('cases.create') && !filtered && (
                        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                            <i className="fas fa-plus me-2" aria-hidden="true" />{t('Buat case')}
                        </button>
                    )}
                </EmptyState>
            ) : (
                <div className="panel">
                    <table className="data-table">
                        <thead>
                            <tr>
                                {canPick && (
                                    <th className="check-col">
                                        <input type="checkbox" className="form-check-input" aria-label={t('Pilih semua case yang tampil')}
                                            checked={cases.length > 0 && cases.every(item => isPicked(item.id))}
                                            onChange={event => setPicked(current => (event.target.checked
                                                ? [...current, ...cases.filter(item => !current.some(entry => entry.id === item.id))
                                                    .map(item => ({ id: item.id, caseNumber: item.caseNumber }))].slice(0, 50)
                                                : current.filter(entry => !cases.some(item => item.id === entry.id))))} />
                                    </th>
                                )}
                                <th>{t('Case')}</th>
                                {!categoryId && <th className="hide-md">{t('Kategori')}</th>}
                                <th>{t('Status')}</th>
                                <th className="text-end">{t('Slide')}</th>
                                <th className="hide-md">{t('Dibuat')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {cases.map(item => (
                                <tr key={item.id} className={`row-link${isPicked(item.id) ? ' is-picked' : ''}`} onClick={() => navigate(`/cases/${item.id}`)}>
                                    {canPick && (
                                        <td className="check-col" onClick={event => event.stopPropagation()}>
                                            <input type="checkbox" className="form-check-input" aria-label={t('Pilih case {name}', { name: item.caseNumber })}
                                                checked={isPicked(item.id)} onChange={() => togglePick(item)} />
                                        </td>
                                    )}
                                    <td>
                                        <Link to={`/cases/${item.id}`} className="case-cell" onClick={event => event.stopPropagation()}>
                                            <span className="case-cell-name">{item.title}</span>
                                            <span className="case-cell-number">{item.caseNumber}</span>
                                        </Link>
                                    </td>
                                    {!categoryId && <td className="hide-md"><CategoryBadge category={item.category} /></td>}
                                    <td><StatusBadge status={item.status} /></td>
                                    <td className="text-end tabular">
                                        <span className="slide-count"><i className="far fa-images" aria-hidden="true" />{item.slideCount}</span>
                                    </td>
                                    <td className="hide-md text-muted-2">
                                        {formatDate(item.createdAt)}
                                        {item.createdBy && <div className="small">{item.createdBy}</div>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {cases && cases.length > 0 && (
                <Pagination page={page} pageSize={paging.pageSize} total={paging.total} onChange={setPage} />
            )}

            {picked.length > 0 && (
                <div className="compare-bar">
                    <span className="compare-bar-text">
                        {t('{n} case dipilih', { n: picked.length })}
                        <span className="d-none d-md-inline text-muted"> · {picked.slice(0, 4).map(item => item.caseNumber).join(', ')}{picked.length > 4 ? ', …' : ''}</span>
                    </span>
                    <button type="button" className="btn btn-sm btn-light" onClick={() => setPicked([])}>{t('Batal')}</button>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => setSharing(true)}>
                        <i className="fas fa-share-alt me-1" aria-hidden="true" />{' '}{t('Bagikan')}
                    </button>
                </div>
            )}
            {sharing && (
                <ShareDialog
                    target={{
                        type: 'cases',
                        ids: picked.map(item => item.id),
                        label: `${t('{n} case pilihan', { n: picked.length })}: ${picked.slice(0, 4).map(item => item.caseNumber).join(', ')}${picked.length > 4 ? ', …' : ''}`,
                    }}
                    onClose={() => setSharing(false)}
                />
            )}
            {creating && (
                <CaseFormModal
                    initial={null}
                    defaultCategoryId={category ? category.id : null}
                    categories={categories}
                    onClose={() => setCreating(false)}
                    onSaved={created => navigate(`/cases/${created.id}`)}
                />
            )}
        </div>
    );
}
