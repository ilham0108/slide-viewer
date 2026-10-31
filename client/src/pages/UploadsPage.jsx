import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SLIDES_CHANGED_EVENT, api, notifyCasesChanged, notifySlidesChanged } from '../api';
import { useAuth } from '../auth/AuthContext';
import { CategoryBadge } from '../components/Badges';
import { SlideThumbnail } from '../components/SlideCard';
import { EmptyState, LoadingState, PageHeader } from '../components/States';
import { useToast } from '../components/Toast';
import Pagination from '../components/Pagination';
import UploadDialog from '../components/UploadDialog';
import { useUploadItems } from '../components/UploadQueue';
import { displayName, formatBytes, formatDate } from '../utils/format';
import { t } from '../i18n';

const STATUS = {
    ready: { label: 'Siap', className: 'is-ready' },
    failed: { label: 'Gagal dibuka', className: 'is-failed' },
    processing: { label: 'Diproses', className: 'is-processing' },
};
// Uploads in this tab's queue that are not slides yet.
const IN_PROGRESS_STATES = new Set(['queued', 'uploading', 'error']);
// While unfinished uploads exist on the server, refresh them (other tabs/users progress).
const SESSION_REFRESH_MS = 5000;

const percentOf = (part, whole) => (whole ? Math.floor((part / whole) * 100) : 0);

function UploadProgress({ percent, tone }) {
    return (
        <div className={`upload-row-progress${tone ? ` is-${tone}` : ''}`}>
            <div className="progress" style={{ height: 5 }}>
                <div className="progress-bar" style={{ width: `${percent}%` }} />
            </div>
        </div>
    );
}

function DestinationCell({ caseItem, category, label, link }) {
    if (caseItem) {
        return (
            <Link to={`/cases/${caseItem.id}`} className="case-cell">
                <span className="case-cell-name">{caseItem.title}</span>
                <span className="case-cell-number">{caseItem.caseNumber}</span>
            </Link>
        );
    }
    if (category) {
        return (
            <span className="upload-destination">
                <CategoryBadge category={category} />
                <span className="small text-muted-2">{t('tanpa case')}</span>
            </span>
        );
    }
    if (label) return <Link to={link} className="upload-slide-name">{label}</Link>;
    return <span className="text-muted-2">{t('Belum dikelompokkan')}</span>;
}

/**
 * Every uploaded slide in a table: destination, status, size and date, with search, paging
 * and deleting several at once. The uploader column comes only for administrators (the
 * server leaves it out for everyone else).
 */
export default function UploadsPage() {
    const { can, user } = useAuth();
    const toast = useToast();
    const { items: queueItems, cancel: cancelQueued, retry: retryQueued } = useUploadItems();
    const [sessions, setSessions] = useState([]);
    const [data, setData] = useState(null);
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(1);
    const [picked, setPicked] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const canDelete = can('slides.delete');

    const load = useCallback(async () => {
        const params = new URLSearchParams({ page: String(page) });
        if (query) params.set('search', query);
        try {
            setData(await api(`/slides/uploads?${params}`));
        } catch (error) {
            toast(error.message, 'error');
            setData({ slides: [], total: 0, page: 1, pageSize: 50, showUploader: false });
        }
    }, [page, query, toast]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        window.addEventListener(SLIDES_CHANGED_EVENT, load);
        return () => window.removeEventListener(SLIDES_CHANGED_EVENT, load);
    }, [load]);

    // Unfinished uploads kept on the server (closed tab, lost connection, other users).
    const loadSessions = useCallback(() => {
        if (!can('slides.upload')) return;
        api('/uploads').then(result => setSessions(result.sessions)).catch(() => {});
    }, [can]);

    useEffect(() => {
        loadSessions();
        window.addEventListener(SLIDES_CHANGED_EVENT, loadSessions);
        return () => window.removeEventListener(SLIDES_CHANGED_EVENT, loadSessions);
    }, [loadSessions]);

    useEffect(() => {
        if (!sessions.length) return undefined;
        const timer = setInterval(loadSessions, SESSION_REFRESH_MS);
        return () => clearInterval(timer);
    }, [sessions.length, loadSessions]);

    const deleteSession = async session => {
        if (!window.confirm(t('Hapus upload {name} yang belum selesai?', { name: session.fileName }))) return;
        try {
            await api(`/uploads/${session.id}`, { method: 'DELETE' });
            setSessions(current => current.filter(item => item.id !== session.id));
        } catch (error) {
            toast(error.message, 'error');
        }
    };

    // Search after a short pause in typing, from the first page.
    useEffect(() => {
        const timer = setTimeout(() => {
            setQuery(search.trim());
            setPage(1);
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    const slides = data?.slides || [];
    const isPicked = id => picked.includes(id);
    const togglePick = id => setPicked(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id]));
    const deletable = slides.filter(slide => slide.status !== 'processing');
    const allPicked = deletable.length > 0 && deletable.every(slide => isPicked(slide.id));

    const deletePicked = async () => {
        if (!window.confirm(t('Hapus {n} slide beserta file dan anotasinya? Tindakan ini tidak dapat dibatalkan.', { n: picked.length }))) return;
        setDeleting(true);
        try {
            const result = await api('/slides/delete', { method: 'POST', body: { ids: picked } });
            toast(result.skipped.length
                ? t('{deleted} slide dihapus, {skipped} dilewati (sedang diproses atau sudah tidak ada).', { deleted: result.deleted.length, skipped: result.skipped.length })
                : t('{n} slide dihapus.', { n: result.deleted.length }), 'success');
            setPicked([]);
            notifyCasesChanged();
            notifySlidesChanged();
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            setDeleting(false);
        }
    };

    const showUploader = Boolean(data?.showUploader);

    // In-progress rows lead the first page of the unfiltered list: this tab's queue, then
    // server sessions this tab is not sending (stalled, or running elsewhere).
    const showInProgress = page === 1 && !query;
    const localRows = queueItems.filter(item => IN_PROGRESS_STATES.has(item.state));
    const localSessionIds = new Set(queueItems.map(item => item.sessionId).filter(Boolean));
    const otherSessions = sessions.filter(session => !localSessionIds.has(session.id));
    const inProgressCount = localRows.length + otherSessions.length;

    return (
        <div className="page">
            <PageHeader
                title="Upload"
                subtitle="Semua slide yang telah diunggah, beserta tujuan dan statusnya."
                actions={can('slides.upload') && (
                    <button type="button" className="btn btn-primary" onClick={() => setUploading(true)}>
                        <i className="fas fa-cloud-upload-alt me-2" aria-hidden="true" />{t('Unggah slide')}
                    </button>
                )}
            />

            <div className="toolbar">
                <div className="search-field">
                    <i className="fas fa-search" aria-hidden="true" />
                    <input className="form-control" placeholder={t('Cari nama slide, case, atau kategori')} value={search}
                        onChange={event => setSearch(event.target.value)} aria-label={t('Cari slide')} />
                </div>
                {data && (
                    <span className="toolbar-count">
                        {t('{n} slide', { n: data.total })}
                        {inProgressCount > 0 && <> · {t('{n} sedang diunggah', { n: inProgressCount })}</>}
                    </span>
                )}
            </div>

            {!data ? <LoadingState message={t('Memuat daftar slide…')} /> : !slides.length && !(showInProgress && inProgressCount) ? (
                <EmptyState icon="fa-cloud-upload-alt" message={query ? 'Tidak ada slide yang cocok' : 'Belum ada slide'}
                    description={query ? t('Ubah kata kunci pencarian.') : t('Unggah slide ke sebuah case atau kategori.')}>
                    {can('slides.upload') && !query && (
                        <button type="button" className="btn btn-primary" onClick={() => setUploading(true)}>
                            <i className="fas fa-cloud-upload-alt me-2" aria-hidden="true" />{t('Unggah slide')}
                        </button>
                    )}
                </EmptyState>
            ) : (
                <div className="panel">
                    <div className="table-responsive">
                        <table className="data-table uploads-table">
                            <thead>
                                <tr>
                                    {canDelete && (
                                        <th className="check-col">
                                            <input type="checkbox" className="form-check-input" aria-label={t('Pilih semua slide yang tampil')}
                                                checked={allPicked}
                                                onChange={event => setPicked(current => (event.target.checked
                                                    ? [...new Set([...current, ...deletable.map(slide => slide.id)])]
                                                    : current.filter(id => !deletable.some(slide => slide.id === id))))} />
                                        </th>
                                    )}
                                    <th>{t('Slide')}</th>
                                    <th>{t('Tujuan')}</th>
                                    <th>{t('Status')}</th>
                                    <th className="text-end hide-md">{t('Ukuran')}</th>
                                    {showUploader && <th className="hide-md">{t('Diunggah oleh')}</th>}
                                    <th className="hide-md">{t('Tanggal')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {showInProgress && localRows.map(item => (
                                    <tr key={`queue-${item.id}`} className="upload-row-active">
                                        {canDelete && <td className="check-col" />}
                                        <td>
                                            <div className="upload-slide-cell">
                                                <span className="upload-slide-thumb is-icon">
                                                    <i className={item.state === 'error' ? 'fas fa-exclamation-circle' : item.state === 'queued' ? 'far fa-clock' : 'fas fa-arrow-up'} aria-hidden="true" />
                                                </span>
                                                <span className="upload-slide-text">
                                                    <span className="upload-slide-name" title={item.name}>{item.name}</span>
                                                    <span className="small text-muted-2">{t('Di tab ini')}</span>
                                                </span>
                                            </div>
                                        </td>
                                        <td>
                                            <DestinationCell label={item.label} link={item.link} />
                                        </td>
                                        <td>
                                            <div className="upload-row-status">
                                                {item.state === 'uploading' && (
                                                    <>
                                                        <span className="slide-status is-uploading">
                                                            {item.retrying ? t('Mencoba lagi ({n})', { n: item.retrying }) : `${t('Mengunggah')} ${item.percent}%`}
                                                        </span>
                                                        <UploadProgress percent={item.percent} />
                                                    </>
                                                )}
                                                {item.state === 'queued' && <span className="slide-status is-processing">{t('Menunggu')}</span>}
                                                {item.state === 'error' && <span className="slide-status is-failed" title={item.error}>{t('Gagal')}</span>}
                                                <span className="upload-row-actions">
                                                    {item.state === 'error' && (
                                                        <button type="button" className="icon-btn" title={t('Coba lagi')} onClick={() => retryQueued(item.id)}>
                                                            <i className="fas fa-redo" aria-hidden="true" />
                                                        </button>
                                                    )}
                                                    {item.state !== 'error' && (
                                                        <button type="button" className="icon-btn" title={t('Batalkan')} onClick={() => cancelQueued(item.id)}>
                                                            <i className="fas fa-times" aria-hidden="true" />
                                                        </button>
                                                    )}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="text-end tabular hide-md">
                                            {item.state === 'uploading' ? `${formatBytes(item.loaded)} / ${formatBytes(item.size)}` : formatBytes(item.size)}
                                        </td>
                                        {showUploader && <td className="hide-md">{user?.name}<div className="small text-muted-2">@{user?.username}</div></td>}
                                        <td className="hide-md text-muted-2">{t('Sekarang')}</td>
                                    </tr>
                                ))}
                                {showInProgress && otherSessions.map(session => {
                                    const percent = percentOf(session.offset, session.size);
                                    return (
                                        <tr key={`session-${session.id}`} className="upload-row-active">
                                            {canDelete && <td className="check-col" />}
                                            <td>
                                                <div className="upload-slide-cell">
                                                    <span className="upload-slide-thumb is-icon">
                                                        <i className={session.receiving ? 'fas fa-arrow-up' : 'fas fa-pause'} aria-hidden="true" />
                                                    </span>
                                                    <span className="upload-slide-text">
                                                        <span className="upload-slide-name" title={session.fileName}>{session.fileName}</span>
                                                        <span className="small text-muted-2">
                                                            {session.receiving
                                                                ? t('Berjalan di tab atau perangkat lain')
                                                                : session.mine
                                                                    ? t('Pilih file yang sama di Unggah slide untuk melanjutkan')
                                                                    : t('Ditinggalkan pengunggahnya')}
                                                        </span>
                                                    </span>
                                                </div>
                                            </td>
                                            <td><DestinationCell caseItem={session.case} category={session.category} /></td>
                                            <td>
                                                <div className="upload-row-status">
                                                    <span className={`slide-status ${session.receiving ? 'is-uploading' : 'is-stalled'}`}>
                                                        {session.receiving ? `${t('Mengunggah')} ${percent}%` : t('Terhenti di {n}%', { n: percent })}
                                                    </span>
                                                    <UploadProgress percent={percent} tone={session.receiving ? null : 'stalled'} />
                                                    {!session.receiving && (
                                                        <span className="upload-row-actions">
                                                            <button type="button" className="icon-btn" title={t('Hapus upload yang belum selesai')} onClick={() => deleteSession(session)}>
                                                                <i className="far fa-trash-alt" aria-hidden="true" />
                                                            </button>
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="text-end tabular hide-md">{formatBytes(session.offset)} / {formatBytes(session.size)}</td>
                                            {showUploader && (
                                                <td className="hide-md">
                                                    {session.uploadedBy
                                                        ? <>{session.uploadedBy.name}<div className="small text-muted-2">@{session.uploadedBy.username}</div></>
                                                        : <span className="text-muted-2">—</span>}
                                                </td>
                                            )}
                                            <td className="hide-md text-muted-2">{formatDate(session.updatedAt, true)}</td>
                                        </tr>
                                    );
                                })}
                                {slides.map(slide => {
                                    const status = STATUS[slide.status] || STATUS.processing;
                                    return (
                                        <tr key={slide.id} className={isPicked(slide.id) ? 'is-picked' : undefined}>
                                            {canDelete && (
                                                <td className="check-col">
                                                    <input type="checkbox" className="form-check-input" disabled={slide.status === 'processing'}
                                                        aria-label={t('Pilih slide {name}', { name: displayName(slide) })}
                                                        checked={isPicked(slide.id)} onChange={() => togglePick(slide.id)} />
                                                </td>
                                            )}
                                            <td>
                                                <div className="upload-slide-cell">
                                                    <span className="upload-slide-thumb"><SlideThumbnail slide={slide} /></span>
                                                    <span className="upload-slide-text">
                                                        {slide.status === 'ready'
                                                            ? <Link to={`/viewer/${slide.id}`} className="upload-slide-name">{displayName(slide)}</Link>
                                                            : <span className="upload-slide-name">{displayName(slide)}</span>}
                                                        {slide.magnification && <span className="small text-muted-2">{slide.magnification}×</span>}
                                                    </span>
                                                </div>
                                            </td>
                                            <td>
                                                {slide.case ? (
                                                    <Link to={`/cases/${slide.case.id}`} className="case-cell">
                                                        <span className="case-cell-name">{slide.case.title}</span>
                                                        <span className="case-cell-number">{slide.case.caseNumber}</span>
                                                    </Link>
                                                ) : slide.category ? (
                                                    <span className="upload-destination">
                                                        <CategoryBadge category={slide.category} />
                                                        <span className="small text-muted-2">{t('tanpa case')}</span>
                                                    </span>
                                                ) : <span className="text-muted-2">{t('Belum dikelompokkan')}</span>}
                                            </td>
                                            <td>
                                                <span className={`slide-status ${status.className}`} title={slide.errorMessage || undefined}>{t(status.label)}</span>
                                            </td>
                                            <td className="text-end tabular hide-md">{slide.sizeBytes ? formatBytes(slide.sizeBytes) : '—'}</td>
                                            {showUploader && (
                                                <td className="hide-md">
                                                    {slide.uploadedBy
                                                        ? <>{slide.uploadedBy.name}<div className="small text-muted-2">@{slide.uploadedBy.username}</div></>
                                                        : <span className="text-muted-2">—</span>}
                                                </td>
                                            )}
                                            <td className="hide-md text-muted-2">{formatDate(slide.createdAt, true)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {data && slides.length > 0 && (
                <Pagination page={page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
            )}

            {picked.length > 0 && (
                <div className="compare-bar">
                    <span className="compare-bar-text">{t('{n} slide dipilih', { n: picked.length })}</span>
                    <button type="button" className="btn btn-sm btn-light" onClick={() => setPicked([])}>{t('Batal')}</button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={deletePicked} disabled={deleting}>
                        <i className="far fa-trash-alt me-1" aria-hidden="true" />{' '}{t('Hapus')}
                    </button>
                </div>
            )}

            {uploading && <UploadDialog onClose={() => setUploading(false)} />}
        </div>
    );
}
