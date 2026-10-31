import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import Modal from '../components/Modal';
import ShareDialog from '../components/ShareDialog';
import { EmptyState, LoadingState } from '../components/States';
import { displayName, numberFormat } from '../utils/format';
import SlideViewer from '../viewer/SlideViewer';
import { DEFAULT_SCANNER_MAG, formatMpp, getViewState, scannerMagOf } from '../viewer/magnification';
import { ViewerControls, useFullscreen } from '../viewer/ViewerControls';
import { t } from '../i18n';

export function HelpModal({ onClose, editable = true }) {
    return (
        <Modal title={t('Panduan singkat')} onClose={onClose}>
            <table className="table table-sm shortcut-table mb-0">
                <tbody>
                    <tr><td>{t('Perbesar / perkecil')}</td><td><kbd>{t('Scroll')}</kbd>{' '}{t('atau')}{' '}<kbd>+</kbd> <kbd>−</kbd></td></tr>
                    <tr><td>{t('Geser slide')}</td><td>Klik &amp; seret (alat Geser)</td></tr>
                    <tr><td>{t('Tampilkan seluruh slide')}</td><td><kbd>0</kbd></td></tr>
                    <tr>
                        <td>{t(editable ? 'Penggaris (tersimpan sebagai anotasi)' : 'Penggaris (sementara, Esc untuk menghapus)')}</td>
                        <td><kbd>{t('M')}</kbd></td>
                    </tr>
                    <tr><td>{t('Tampilkan / sembunyikan penggaris tepi layar')}</td><td><kbd>{t('G')}</kbd></td></tr>
                    {editable && (
                        <>
                            <tr><td>{t('Alat Geser / Persegi / Elips')}</td><td><kbd>{t('V')}</kbd> <kbd>{t('R')}</kbd> <kbd>{t('E')}</kbd></td></tr>
                            <tr><td>{t('Alat Panah / Gambar bebas / Teks')}</td><td><kbd>{t('A')}</kbd> <kbd>{t('F')}</kbd> <kbd>{t('T')}</kbd></td></tr>
                            <tr><td>{t('Batalkan anotasi terakhir')}</td><td><kbd>{t('Ctrl')}</kbd> + <kbd>{t('Z')}</kbd></td></tr>
                            <tr><td>{t('Simpan anotasi')}</td><td><kbd>{t('Ctrl')}</kbd> + <kbd>{t('S')}</kbd></td></tr>
                            <tr><td>{t('Kembali ke alat Geser')}</td><td><kbd>{t('Esc')}</kbd></td></tr>
                        </>
                    )}
                </tbody>
            </table>
            <p className="text-muted small mt-3 mb-0">
                {t('Perbesaran dihitung dari perbesaran objektif scanner. Skala, posisi, dan penggaris memakai ukuran piksel (µm/px) dari file slide; tanda ≈ berarti nilainya perkiraan karena file tidak menyimpan ukuran piksel.')}
            </p>
        </Modal>
    );
}

export default function ViewerPage() {
    const { slideId } = useParams();
    const { can } = useAuth();
    const navigate = useNavigate();
    const [slide, setSlide] = useState(null);
    const [error, setError] = useState(null);
    const [viewer, setViewer] = useState(null);
    const [size, setSize] = useState(null);
    const [dirty, setDirty] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [sharing, setSharing] = useState(false);
    const screenRef = useRef(null);
    const { isFullscreen, toggleFullscreen } = useFullscreen(screenRef);

    useEffect(() => {
        setSlide(null);
        setSize(null);
        setError(null);
        api(`/slides/${slideId}`)
            .then(data => {
                if (data.slide.status !== 'ready') throw Object.assign(new Error('Slide belum siap dilihat.'), { status: 409 });
                setSlide(data.slide);
            })
            .catch(setError);
    }, [slideId]);

    // Unsaved annotations: confirm before leaving through the app or closing the tab.
    const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
    useEffect(() => {
        if (blocker.state !== 'blocked') return;
        if (window.confirm(t('Ada anotasi yang belum disimpan. Tetap tinggalkan halaman ini?'))) blocker.proceed();
        else blocker.reset();
    }, [blocker]);
    useEffect(() => {
        if (!dirty) return undefined;
        const onBeforeUnload = event => {
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [dirty]);

    const onDirtyChange = useCallback(value => setDirty(value), []);

    if (error) {
        return (
            <div className="page">
                <EmptyState icon="fa-exclamation-circle" tone="danger" message={error.status === 404 ? 'Slide tidak ditemukan.' : error.message}>
                    <button type="button" className="btn btn-sm btn-light" onClick={() => navigate(-1)}>{t('Kembali')}</button>
                </EmptyState>
            </div>
        );
    }
    if (!slide) return <div className="page"><LoadingState message={t('Memuat slide…')} /></div>;

    const backTo = slide.case && can('cases.view') ? `/cases/${slide.case.id}` : '/';
    const meta = [
        slide.magnification ? `${slide.magnification}×` : `${DEFAULT_SCANNER_MAG}× (${t('perkiraan')})`,
        formatMpp(slide),
        size && `${numberFormat.format(size.width)} × ${numberFormat.format(size.height)} px`,
    ].filter(Boolean);

    return (
        <div className="viewer-screen" ref={screenRef}>
            <div className="viewer-topbar">
                <Link to={backTo} className="vt-btn vt-back" title={t('Kembali')}>
                    <i className="fas fa-arrow-left" aria-hidden="true" />
                    <span>{slide.case ? slide.case.caseNumber : t('Semua slide')}</span>
                </Link>
                <div className="vt-title">
                    <h1 title={slide.originalName}>{displayName(slide)}</h1>
                    <span>{meta.join(' · ')}</span>
                </div>
                <ViewerControls viewer={viewer} isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen}>
                    <span className="vt-divider" aria-hidden="true" />
                    {can('shares.create') && (
                        <button type="button" className="vt-btn vt-share" title={t('Bagikan link slide ini')} onClick={() => setSharing(true)}>
                            <i className="fas fa-share-alt" aria-hidden="true" /><span className="vt-hide-sm">{t('Bagikan')}</span>
                        </button>
                    )}
                    <Link to={`/compare?slides=${slide.id}`} className="vt-btn" title={t('Bandingkan dengan slide lain')}>
                        <i className="fas fa-columns" aria-hidden="true" />
                    </Link>
                    <button type="button" className="vt-btn" title={t('Bantuan')} onClick={() => setShowHelp(true)}>
                        <i className="far fa-question-circle" aria-hidden="true" />
                    </button>
                </ViewerControls>
            </div>
            <SlideViewer
                slide={slide}
                editable={can('annotations.edit')}
                keyboard={!showHelp && !sharing}
                onReady={setViewer}
                onOpen={setSize}
                onDirtyChange={onDirtyChange}
            />
            {showHelp && <HelpModal onClose={() => setShowHelp(false)} editable={can('annotations.edit')} />}
            {sharing && (
                <ShareDialog
                    target={{
                        type: 'slide',
                        resourceId: slide.id,
                        label: displayName(slide),
                        getViewState: () => getViewState(viewer, scannerMagOf(slide)),
                    }}
                    onClose={() => setSharing(false)}
                />
            )}
        </div>
    );
}
