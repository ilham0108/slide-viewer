import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { SLIDES_CHANGED_EVENT, api, notifyCasesChanged } from '../api';
import { useAuth } from '../auth/AuthContext';
import { CategoryBadge, StatusBadge } from '../components/Badges';
import CaseFormModal from '../components/CaseFormModal';
import { useSlideSelection } from '../components/CompareBar';
import SlideCard from '../components/SlideCard';
import ShareDialog from '../components/ShareDialog';
import { useSlideActions } from '../components/SlideActions';
import { EmptyState, LoadingState, PageHeader } from '../components/States';
import { useToast } from '../components/Toast';
import { ACCEPTED_SLIDE_FILES, useUploadQueue } from '../components/UploadQueue';
import { caseLabel as formatCaseLabel, formatDate } from '../utils/format';
import { t } from '../i18n';

const POLL_INTERVAL_MS = 3000;

export default function CaseDetailPage() {
    const { caseId } = useParams();
    const { can } = useAuth();
    const toast = useToast();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [categories, setCategories] = useState([]);
    const [editing, setEditing] = useState(false);
    const selection = useSlideSelection();
    const [sharing, setSharing] = useState(false);

    const load = useCallback(async () => {
        try {
            setData(await api(`/cases/${caseId}`));
            setError(null);
        } catch (loadError) {
            setError(loadError);
        }
    }, [caseId]);

    useEffect(() => {
        setData(null);
        load();
    }, [load]);

    // While a slide is converting, refresh so its progress and final state appear.
    const processing = data?.slides.some(slide => slide.status === 'processing');
    // Refresh the sidebar's slide count once conversions finish.
    useEffect(() => {
        if (processing === false) notifyCasesChanged();
    }, [processing]);

    useEffect(() => {
        if (!processing) return undefined;
        const timer = setInterval(load, POLL_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [processing, load]);

    // Uploads (app-wide queue) and bulk deletes (selection bar) change the slide list.
    useEffect(() => {
        window.addEventListener(SLIDES_CHANGED_EVENT, load);
        return () => window.removeEventListener(SLIDES_CHANGED_EVENT, load);
    }, [load]);

    const { actionsFor, modal } = useSlideActions({ onChanged: load });
    const uploads = useUploadQueue();
    const fileInputRef = useRef(null);
    const canUpload = can('slides.upload') && Boolean(data);
    const caseLabel = data ? formatCaseLabel(data.case) : '';

    const queueFiles = useCallback(files => {
        uploads.addFiles(files, { target: { caseId: Number(caseId) }, label: caseLabel, link: `/cases/${caseId}` });
    }, [uploads, caseId, caseLabel]);

    // Files can be dropped anywhere on the page. Listening on window also stops the browser
    // from opening a file dropped outside the slide area.
    const [dragging, setDragging] = useState(false);
    useEffect(() => {
        if (!canUpload) return undefined;
        let depth = 0;
        const hasFiles = event => event.dataTransfer?.types?.includes('Files');
        const onEnter = event => {
            if (!hasFiles(event)) return;
            depth += 1;
            setDragging(true);
        };
        const onLeave = event => {
            if (!hasFiles(event)) return;
            depth = Math.max(0, depth - 1);
            if (!depth) setDragging(false);
        };
        const onOver = event => {
            if (hasFiles(event)) event.preventDefault();
        };
        const onDrop = event => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            depth = 0;
            setDragging(false);
            if (event.dataTransfer.files.length) queueFiles(event.dataTransfer.files);
        };
        window.addEventListener('dragenter', onEnter);
        window.addEventListener('dragleave', onLeave);
        window.addEventListener('dragover', onOver);
        window.addEventListener('drop', onDrop);
        return () => {
            window.removeEventListener('dragenter', onEnter);
            window.removeEventListener('dragleave', onLeave);
            window.removeEventListener('dragover', onOver);
            window.removeEventListener('drop', onDrop);
        };
    }, [canUpload, queueFiles]);

    const chooseFiles = () => fileInputRef.current?.click();

    const openEditor = async () => {
        try {
            setCategories((await api('/categories')).categories);
            setEditing(true);
        } catch (loadError) {
            toast(loadError.message, 'error');
        }
    };

    const deleteCase = async () => {
        if (!window.confirm(t('Hapus case {name}?', { name: data.case.caseNumber }))) return;
        try {
            await api(`/cases/${caseId}`, { method: 'DELETE' });
            toast('Case dihapus.', 'success');
            notifyCasesChanged();
            navigate('/cases', { replace: true });
        } catch (deleteError) {
            toast(deleteError.message, 'error');
        }
    };

    if (error) {
        return (
            <div className="page">
                <EmptyState icon="fa-exclamation-circle" tone="danger" message={error.status === 404 ? 'Case tidak ditemukan' : error.message}>
                    <Link to="/cases" className="btn btn-outline-secondary">{t('Kembali ke daftar case')}</Link>
                </EmptyState>
            </div>
        );
    }
    if (!data) return <div className="page"><LoadingState message={t('Memuat case…')} /></div>;

    const { case: item, slides } = data;
    const readySlides = slides.filter(slide => slide.status === 'ready');

    return (
        <div className="page">
            <PageHeader
                back={(
                    <nav className="breadcrumbs" aria-label={t('Breadcrumb')}>
                        <Link to="/cases">{t('Case')}</Link>
                        <i className="fas fa-chevron-right" aria-hidden="true" />
                        {item.category
                            ? <Link to={`/?category=${item.category.id}`}>{item.category.name}</Link>
                            : <Link to="/?category=none">{t('Tanpa kategori')}</Link>}
                        <i className="fas fa-chevron-right" aria-hidden="true" />
                        <span>{item.title}</span>
                    </nav>
                )}
                title={item.title}
                subtitle={(
                    <span className="case-meta">
                        <span className="case-number-pill">{item.caseNumber}</span>
                        <CategoryBadge category={item.category} />
                        <StatusBadge status={item.status} />
                        <span className="case-meta-item">
                            {t('Dibuat {date}', { date: formatDate(item.createdAt, true) })}
                            {item.createdBy && <> · {item.createdBy}</>}
                        </span>
                    </span>
                )}
                actions={(
                    <>
                        {canUpload && (
                            <button type="button" className="btn btn-primary" onClick={chooseFiles}>
                                <i className="fas fa-cloud-upload-alt me-2" aria-hidden="true" />{t('Unggah slide')}
                            </button>
                        )}
                        {readySlides.length >= 2 && (
                            <button type="button" className="btn btn-outline-secondary"
                                onClick={() => navigate(`/compare?slides=${readySlides.slice(0, 4).map(slide => slide.id).join(',')}`)}>
                                <i className="fas fa-columns me-2" aria-hidden="true" />{t('Bandingkan')}
                            </button>
                        )}
                        {can('shares.create') && (
                            <button type="button" className="btn btn-outline-secondary" onClick={() => setSharing(true)}>
                                <i className="fas fa-share-alt me-2" aria-hidden="true" />{t('Bagikan')}
                            </button>
                        )}
                        {can('cases.update') && (
                            <button type="button" className="btn btn-outline-secondary" onClick={openEditor}>
                                <i className="fas fa-pen me-2" aria-hidden="true" />{t('Ubah')}
                            </button>
                        )}
                        {can('cases.delete') && (
                            <button type="button" className="btn btn-outline-danger" onClick={deleteCase} title={t('Hapus case')}>
                                <i className="far fa-trash-alt" aria-hidden="true" /><span className="visually-hidden">{t('Hapus')}</span>
                            </button>
                        )}
                    </>
                )}
            />

            {item.description && (
                <div className="case-notes-inline">
                    <div className="facts-label">{t('Catatan klinis')}</div>
                    <p>{item.description}</p>
                </div>
            )}

            <div className="section-header">
                <h2 className="section-title">{t('Slide')}{' '}<span className="section-count">{slides.length}</span></h2>
                {slides.length > 1 && <span className="section-hint">{t('Centang slide untuk membandingkan berdampingan')}</span>}
            </div>
            {!slides.length ? (
                <EmptyState icon="fa-images" message={t('Belum ada slide')}
                    description={canUpload ? t('Seret file .svs, .tif, atau .tiff ke halaman ini, atau pilih file. Beberapa file sekaligus akan diunggah bergantian.') : t('Slide yang diunggah ke case ini akan muncul di sini.')}>
                    {canUpload && (
                        <button type="button" className="btn btn-primary" onClick={chooseFiles}>
                            <i className="fas fa-cloud-upload-alt me-2" aria-hidden="true" />{t('Pilih file')}
                        </button>
                    )}
                </EmptyState>
            ) : (
                <div className="slide-grid">
                    {slides.map((slide, index) => (
                        <SlideCard key={slide.id} slide={slide} index={index} actions={actionsFor(slide)}
                            selected={selection.isSelected(slide.id)}
                            onToggleSelect={selection.toggle} />
                    ))}
                </div>
            )}

            {canUpload && (
                <input ref={fileInputRef} type="file" accept={ACCEPTED_SLIDE_FILES} multiple hidden
                    onChange={event => { queueFiles(event.target.files); event.target.value = ''; }} />
            )}
            {dragging && (
                <div className="drop-overlay" aria-hidden="true">
                    <div className="drop-overlay-card">
                        <i className="fas fa-cloud-upload-alt" />
                        <strong>{t('Lepas untuk mengunggah')}</strong>
                        <span>{t('ke case {name}', { name: caseLabel })}</span>
                    </div>
                </div>
            )}
            {sharing && (
                <ShareDialog target={{ type: 'case', resourceId: item.id, label: caseLabel }}
                    onClose={() => setSharing(false)} />
            )}
            {modal}
            {editing && (
                <CaseFormModal initial={item} categories={categories} onClose={() => setEditing(false)}
                    onSaved={() => { setEditing(false); load(); }} />
            )}
        </div>
    );
}
