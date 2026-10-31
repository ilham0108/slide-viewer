import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { CategoryBadge, StatusBadge } from '../components/Badges';
import { BrandMark, useBranding } from '../components/Branding';
import Modal from '../components/Modal';
import SlideCard from '../components/SlideCard';
import { EmptyState, LoadingState } from '../components/States';
import { displayName, formatDate, numberFormat } from '../utils/format';
import SlideViewer from '../viewer/SlideViewer';
import { DEFAULT_SCANNER_MAG, formatMpp } from '../viewer/magnification';
import { ViewerControls, useFullscreen } from '../viewer/ViewerControls';
import { CompareWorkspace } from './ComparePage';
import { HelpModal } from './ViewerPage';
import { t } from '../i18n';

const GUEST_NAME_KEY = 'share-guest-name';

function readGuestName() {
    try {
        return localStorage.getItem(GUEST_NAME_KEY) || '';
    } catch {
        return '';
    }
}

function GuestNameModal({ initial, onClose, onSave }) {
    const [name, setName] = useState(initial);
    return (
        <Modal title={t('Isi nama Anda')} onClose={onClose} onSubmit={() => name.trim() && onSave(name.trim())} footer={(
            <>
                <button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('Batal')}</button>
                <button type="submit" className="btn btn-primary" disabled={!name.trim()}>{t('Mulai menganotasi')}</button>
            </>
        )}>
            <p className="text-muted-2">{t('Nama ini dicatat pada setiap anotasi yang Anda buat atau ubah, agar pemilik slide tahu siapa yang menandai.')}</p>
            <label className="form-label" htmlFor="guestName">{t('Nama')}</label>
            <input id="guestName" className="form-control" maxLength={100} autoFocus placeholder={t('mis. dr. Andi, Sp.PA')}
                value={name} onChange={event => setName(event.target.value)} />
        </Modal>
    );
}

const TYPE_LABELS = {
    slide: 'Slide',
    case: 'Case',
    category: 'Kategori',
    compare: 'Perbandingan slide',
    slides: 'Kumpulan slide',
    cases: 'Kumpulan case',
};

function PublicHeader({ share }) {
    const { branding } = useBranding();
    return (
        <header className="app-header public-header">
            <span className="brand">
                <BrandMark />
                <span className="brand-text">
                    <span className="brand-name">{branding.appName}</span>
                    {branding.appSubtitle && <span className="brand-sub">{branding.appSubtitle}</span>}
                </span>
            </span>
            {share && (
                <div className="public-meta">
                    <span className="public-badge"><i className="fas fa-eye" aria-hidden="true" />{t('Hanya-lihat')}</span>
                    <span className="public-meta-text">
                        {share.sharedBy
                            ? t('{what} dibagikan oleh {name}', { what: t(TYPE_LABELS[share.type]), name: share.sharedBy })
                            : t('{what} dibagikan', { what: t(TYPE_LABELS[share.type]) })}
                        {share.expiresAt && ` · ${t('berlaku sampai {date}', { date: formatDate(share.expiresAt, true) })}`}
                    </span>
                </div>
            )}
        </header>
    );
}

function PasswordGate({ share, token, onUnlocked }) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async event => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            await api(`/public/shares/${token}/unlock`, { method: 'POST', body: { password } });
            onUnlocked();
        } catch (unlockError) {
            setError(unlockError.message);
            setPassword('');
            setBusy(false);
        }
    };

    return (
        <div className="login-screen public-gate">
            <form className="login-card" onSubmit={submit}>
                <div className="login-brand">
                    <BrandMark logoUrl={null} icon="fa-lock" />
                    <div>
                        <h1>{share.title}</h1>
                        <p>{t('{what} ini dilindungi password.', { what: t(TYPE_LABELS[share.type]) })}</p>
                    </div>
                </div>
                {error && <div className="alert alert-danger py-2" role="alert">{error}</div>}
                <div className="mb-4">
                    <label className="form-label" htmlFor="sharePassword">{t('Password')}</label>
                    <input id="sharePassword" type="password" className="form-control" autoFocus required
                        value={password} onChange={event => setPassword(event.target.value)} />
                </div>
                <button type="submit" className="btn btn-primary w-100" disabled={busy || !password}>
                    {busy ? t('Memeriksa…') : t('Buka')}
                </button>
            </form>
        </div>
    );
}

/** Full-screen read-only viewer for one shared slide. */
function PublicViewer({ token, data, slide, initialView, backTo }) {
    const [viewer, setViewer] = useState(null);
    const [size, setSize] = useState(null);
    const [showHelp, setShowHelp] = useState(false);
    const canAnnotate = data.share.allowAnnotationEdit;
    const [guestName, setGuestName] = useState(readGuestName);
    const [editing, setEditing] = useState(false);
    const [askName, setAskName] = useState(false);

    const startAnnotating = () => {
        if (guestName) setEditing(true);
        else setAskName(true);
    };
    const screenRef = useRef(null);
    const { isFullscreen, toggleFullscreen } = useFullscreen(screenRef);

    const meta = [
        slide.magnification ? `${slide.magnification}×` : `${DEFAULT_SCANNER_MAG}× (${t('perkiraan')})`,
        formatMpp(slide),
        size && `${numberFormat.format(size.width)} × ${numberFormat.format(size.height)} px`,
    ].filter(Boolean);

    return (
        <div className="viewer-screen" ref={screenRef}>
            <div className="viewer-topbar">
                {backTo && (
                    <Link to={backTo} className="vt-btn vt-back" title={t('Kembali')}>
                        <i className="fas fa-arrow-left" aria-hidden="true" /><span>{t('Kembali')}</span>
                    </Link>
                )}
                <div className="vt-title">
                    <h1 title={slide.originalName}>{data.share.type === 'slide' ? data.share.title : displayName(slide)}</h1>
                    <span>{meta.join(' · ')}</span>
                </div>
                <ViewerControls viewer={viewer} isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen}>
                    {canAnnotate && (editing ? (
                        <button type="button" className="vt-btn vt-share" title={t('Ganti nama')} onClick={() => setAskName(true)}>
                            <i className="fas fa-user-edit" aria-hidden="true" /><span className="vt-hide-sm">{guestName}</span>
                        </button>
                    ) : (
                        <button type="button" className="vt-btn vt-share" onClick={startAnnotating}>
                            <i className="fas fa-pen" aria-hidden="true" /><span className="vt-hide-sm">{t('Anotasi')}</span>
                        </button>
                    ))}
                    <button type="button" className="vt-btn" title={t('Bantuan')} onClick={() => setShowHelp(true)}>
                        <i className="far fa-question-circle" aria-hidden="true" />
                    </button>
                </ViewerControls>
            </div>
            <SlideViewer
                slide={slide}
                editable={canAnnotate && editing && Boolean(guestName)}
                keyboard={!showHelp && !askName}
                onReady={setViewer}
                onOpen={setSize}
                annotationsPath={data.share.showAnnotations ? `/public/shares/${token}/slides/${slide.id}/annotations` : null}
                savePath={`/public/shares/${token}/slides/${slide.id}/annotations`}
                saveExtra={{ authorName: guestName }}
                initialView={initialView}
            />
            {showHelp && <HelpModal onClose={() => setShowHelp(false)} editable={canAnnotate && editing} />}
            {askName && (
                <GuestNameModal
                    initial={guestName}
                    onClose={() => setAskName(false)}
                    onSave={name => {
                        try {
                            localStorage.setItem(GUEST_NAME_KEY, name);
                        } catch {
                            // The name is then asked again next visit.
                        }
                        setGuestName(name);
                        setAskName(false);
                        setEditing(true);
                    }}
                />
            )}
        </div>
    );
}

function CaseBlock({ token, item, slides, headingLevel = 'h1' }) {
    const Heading = headingLevel;
    return (
        <section className="public-case">
            <div className="page-header">
                <div className="page-header-text">
                    <Heading className={headingLevel === 'h1' ? 'page-title' : 'section-title'}>{item.title}</Heading>
                    <p className="page-subtitle"><span className="case-number-pill">{item.caseNumber}</span></p>
                </div>
            </div>
            <section className="panel case-summary">
                <dl className="facts">
                    <div><dt>{t('Kategori')}</dt><dd><CategoryBadge category={item.category} /></dd></div>
                    <div><dt>{t('Status')}</dt><dd><StatusBadge status={item.status} /></dd></div>
                    <div><dt>{t('Slide')}</dt><dd className="tabular">{slides.length}</dd></div>
                    <div><dt>{t('Dibuat')}</dt><dd>{formatDate(item.createdAt)}</dd></div>
                </dl>
                {item.description && (
                    <div className="case-notes">
                        <div className="facts-label">{t('Catatan klinis')}</div>
                        <p>{item.description}</p>
                    </div>
                )}
            </section>
            {slides.length ? (
                <div className="slide-grid mt-3">
                    {slides.map((slide, index) => (
                        <SlideCard key={slide.id} slide={slide} index={index} href={`/s/${token}/slide/${slide.id}`} />
                    ))}
                </div>
            ) : <p className="text-muted-2 mt-3">{t('Belum ada slide pada case ini.')}</p>}
        </section>
    );
}

/** Gallery of a "slides" share; viewers can tick 2–4 slides to compare them. */
function SlideGallery({ token, share, slides }) {
    const navigate = useNavigate();
    const [selected, setSelected] = useState([]);
    const toggle = slide => setSelected(current => (current.includes(slide.id)
        ? current.filter(id => id !== slide.id)
        : current.length >= 4 ? current : [...current, slide.id]));

    return (
        <>
            <div className="page-header">
                <div className="page-header-text">
                    <h1 className="page-title">{share.title}</h1>
                    <p className="page-subtitle">{t('{n} slide · centang 2–4 slide untuk membandingkan berdampingan', { n: slides.length })}</p>
                </div>
            </div>
            {slides.length ? (
                <div className="slide-grid">
                    {slides.map((slide, index) => (
                        <SlideCard key={slide.id} slide={slide} index={index} showCase href={`/s/${token}/slide/${slide.id}`}
                            selected={selected.includes(slide.id)} onToggleSelect={toggle} />
                    ))}
                </div>
            ) : <EmptyState icon="fa-images" message={t('Slide sudah tidak tersedia')} />}
            {selected.length > 0 && (
                <div className="compare-bar">
                    <span className="compare-bar-text">{t('{n} slide dipilih', { n: selected.length })}</span>
                    <button type="button" className="btn btn-sm btn-light" onClick={() => setSelected([])}>{t('Batal')}</button>
                    <button type="button" className="btn btn-sm btn-primary" disabled={selected.length < 2}
                        title={selected.length < 2 ? t('Pilih minimal 2 slide') : undefined}
                        onClick={() => navigate(`/s/${token}/compare?slides=${selected.join(',')}`)}>
                        <i className="fas fa-columns me-1" aria-hidden="true" />{' '}{t('Bandingkan')}
                    </button>
                </div>
            )}
        </>
    );
}

/** Cases (with their slides) for "category" and "cases" shares, then slides that are in no case. */
function CaseList({ token, cases, slides }) {
    const loose = slides.filter(slide => !slide.caseId);
    const slidesByCase = new Map();
    for (const slide of slides) {
        if (!slidesByCase.has(slide.caseId)) slidesByCase.set(slide.caseId, []);
        slidesByCase.get(slide.caseId).push(slide);
    }
    return (
        <>
            {cases.map(item => (
                <div key={item.id} className="public-category-case">
                    <CaseBlock token={token} item={item} slides={slidesByCase.get(item.id) || []} headingLevel="h2" />
                </div>
            ))}
            {loose.length > 0 && (
                <div className="public-category-case">
                    <h2 className="section-title">{t('Slide tanpa case')}</h2>
                    <div className="slide-grid mt-3">
                        {loose.map((slide, index) => (
                            <SlideCard key={slide.id} slide={slide} index={index} href={`/s/${token}/slide/${slide.id}`} />
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}

/**
 * Public, read-only page for a share link (/s/:token). No login: the token, and the
 * password when one is set, decide access. Case, category and comparison shares can open
 * one of their slides at /s/:token/slide/:slideId.
 */
export default function PublicSharePage() {
    const { token, '*': rest } = useParams();
    const [searchParams] = useSearchParams();
    const [state, setState] = useState({ status: 'loading' });
    const { branding: { appName } } = useBranding();

    const load = useCallback(async () => {
        try {
            const data = await api(`/public/shares/${token}`);
            setState({ status: 'ready', data });
        } catch (error) {
            if (error.status === 401) {
                // The 401 body carries the share summary for the password screen.
                setState({ status: 'locked', share: error.data.share });
            } else {
                setState({ status: 'error', message: error.message });
            }
        }
    }, [token]);

    useEffect(() => {
        load();
    }, [load]);

    const data = state.data;
    useEffect(() => {
        if (data) document.title = `${data.share.title} · ${appName}`;
    }, [data, appName]);

    const slideRoute = /^slide\/(\d+)$/.exec(rest || '');
    const slidesById = useMemo(() => new Map((data?.slides || []).map(slide => [slide.id, slide])), [data]);

    if (state.status === 'loading') return <LoadingState message={t('Memuat…')} fullScreen />;
    if (state.status === 'locked') {
        return state.share
            ? <PasswordGate share={state.share} token={token} onUnlocked={load} />
            : <div className="page"><EmptyState icon="fa-lock" tone="danger" message={t('Link ini dilindungi password')} /></div>;
    }
    if (state.status === 'error') {
        return (
            <div className="app">
                <PublicHeader />
                <div className="page">
                    <EmptyState icon="fa-unlink" tone="danger" message={state.message}
                        description={t('Minta link baru kepada pengirim jika Anda masih membutuhkan akses.')} />
                </div>
            </div>
        );
    }

    const { share } = data;
    const home = `/s/${token}`;

    // A single slide inside a case / category / comparison share.
    if (slideRoute) {
        const slide = slidesById.get(Number(slideRoute[1]));
        return (
            <div className="app is-immersive">
                <PublicHeader share={share} />
                <main className="app-main">
                    {slide
                        ? <PublicViewer token={token} data={data} slide={slide} backTo={home} />
                        : <div className="page"><EmptyState icon="fa-image" message={t('Slide tidak termasuk dalam link ini')} /></div>}
                </main>
            </div>
        );
    }

    // Side-by-side view of slides picked by the viewer inside a multi-slide share.
    if (rest === 'compare' && share.type !== 'slide') {
        const ids = (searchParams.get('slides') || '').split(',').map(Number).filter(id => slidesById.has(id)).slice(0, 4);
        const panels = ids.length ? ids : [null, null];
        return (
            <div className="app is-immersive">
                <PublicHeader share={share} />
                <main className="app-main">
                    <CompareWorkspace
                        title={share.title}
                        slides={data.slides.map(slide => ({ ...slide, case: null, groupLabel: 'Slide dibagikan' }))}
                        initialPanels={panels}
                        annotationsPathFor={slide => (share.showAnnotations ? `/public/shares/${token}/slides/${slide.id}/annotations` : null)}
                        slideLink={slide => `/s/${token}/slide/${slide.id}`}
                        renderActions={() => (
                            <Link to={home} className="vt-btn" title={t('Kembali ke daftar')}>
                                <i className="fas fa-th-large" aria-hidden="true" /><span className="vt-hide-sm">{t('Daftar')}</span>
                            </Link>
                        )}
                    />
                </main>
            </div>
        );
    }

    if (share.type === 'slides') {
        return (
            <div className="app">
                <PublicHeader share={share} />
                <main className="page">
                    <SlideGallery token={token} share={share} slides={data.slides} />
                </main>
            </div>
        );
    }

    if (share.type === 'cases') {
        return (
            <div className="app">
                <PublicHeader share={share} />
                <main className="page">
                    <div className="page-header">
                        <div className="page-header-text">
                            <h1 className="page-title">{share.title}</h1>
                            <p className="page-subtitle">{t('{cases} case · {slides} slide', { cases: data.cases.length, slides: data.slides.length })}</p>
                        </div>
                    </div>
                    {data.cases.length ? <CaseList token={token} cases={data.cases} slides={data.slides} />
                        : <EmptyState icon="fa-folder-open" message={t('Case sudah tidak tersedia')} />}
                </main>
            </div>
        );
    }

    if (share.type === 'slide') {
        return (
            <div className="app is-immersive">
                <PublicHeader share={share} />
                <main className="app-main">
                    {data.slides[0]
                        ? <PublicViewer token={token} data={data} slide={data.slides[0]} initialView={data.view} />
                        : <div className="page"><EmptyState icon="fa-image" message={t('Slide sudah tidak tersedia')} /></div>}
                </main>
            </div>
        );
    }

    if (share.type === 'compare') {
        const compare = data.compare;
        const slides = data.slides.map(slide => ({ ...slide, groupLabel: 'Slide dibagikan' }));
        const available = new Set(slides.map(slide => slide.id));
        const panels = compare.slides.map(id => (available.has(id) ? id : null));
        return (
            <div className="app is-immersive">
                <PublicHeader share={share} />
                <main className="app-main">
                    <CompareWorkspace
                        title={share.title}
                        slides={slides}
                        initialPanels={panels}
                        initialViews={compare.panels}
                        initialSync={compare.sync}
                        annotationsPathFor={slide => (share.showAnnotations ? `/public/shares/${token}/slides/${slide.id}/annotations` : null)}
                        slideLink={slide => `/s/${token}/slide/${slide.id}`}
                    />
                </main>
            </div>
        );
    }

    if (share.type === 'case') {
        return (
            <div className="app">
                <PublicHeader share={share} />
                <main className="page">
                    <CaseBlock token={token} item={data.case} slides={data.slides} />
                </main>
            </div>
        );
    }

    // Category: its cases, each with its slides.
    return (
        <div className="app">
            <PublicHeader share={share} />
            <main className="page">
                <div className="page-header">
                    <div className="page-header-text">
                        <h1 className="page-title">
                            <i className="fas fa-folder-open page-title-icon" style={{ color: data.category.color }} aria-hidden="true" />
                            {share.title}
                        </h1>
                        <p className="page-subtitle">
                            {data.category.description ? `${data.category.description} · ` : ''}
                            {t('{cases} case · {slides} slide', { cases: data.cases.length, slides: data.slides.length })}
                        </p>
                    </div>
                </div>
                {!data.cases.length && !data.slides.length && <EmptyState icon="fa-folder-open" message={t('Belum ada case di kategori ini')} />}
                <CaseList token={token} cases={data.cases} slides={data.slides} />
            </main>
        </div>
    );
}
