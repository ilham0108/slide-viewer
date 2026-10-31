import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { notifyCasesChanged, notifySlidesChanged } from '../api';
import { formatBytes } from '../utils/format';
import { uploadSlideResumable } from '../utils/resumableUpload';
import { t } from '../i18n';

export const ACCEPTED_SLIDE_FILES = '.svs,.tif,.tiff';
const ALLOWED = /\.(svs|tiff?)$/i;
const ACTIVE_STATES = new Set(['queued', 'uploading']);
const FINISHED_STATES = new Set(['done', 'warning', 'error']);
let nextId = 1;

const UploadQueueContext = createContext(null);
// The queued items change on every progress event; only pages that list them subscribe.
const UploadItemsContext = createContext({ items: [], cancel: () => {}, retry: () => {} });

/**
 * Slide uploads of the whole session, sent one file at a time. The queue lives above the
 * pages, so uploads keep going while the user browses elsewhere; the tray in the corner
 * shows their progress.
 */
export function UploadQueueProvider({ children }) {
    const [items, setItems] = useState([]);
    const [minimized, setMinimized] = useState(false);
    const controllers = useRef(new Map());

    const update = useCallback((id, patch) => {
        setItems(current => current.map(item => (item.id === id ? { ...item, ...patch } : item)));
    }, []);

    const start = useCallback(item => {
        const controller = new AbortController();
        controllers.current.set(item.id, controller);
        update(item.id, { state: 'uploading', percent: 0, loaded: 0, error: null, retrying: 0, resumedFrom: 0 });

        uploadSlideResumable(item.target, item.file, {
            onProgress: (loaded, total) => update(item.id, { percent: Math.floor((loaded / total) * 100), loaded }),
            onStatus: status => update(item.id, status),
            signal: controller.signal,
        })
            .then(result => {
                // "failed": the file is kept but the tile service could not open it yet.
                update(item.id, result.status === 'ready'
                    ? { state: 'done', percent: 100 }
                    : { state: 'warning', percent: 100, error: result.message });
                notifySlidesChanged();
                notifyCasesChanged();
            })
            .catch(error => {
                update(item.id, error.name === 'AbortError' ? { state: 'cancelled' } : { state: 'error', error: error.message });
            })
            .finally(() => controllers.current.delete(item.id));
    }, [update]);

    // One upload at a time: when nothing is uploading, start the oldest queued file.
    useEffect(() => {
        if (items.some(item => item.state === 'uploading')) return;
        const next = items.find(item => item.state === 'queued');
        if (next) start(next);
    }, [items, start]);

    const active = items.some(item => ACTIVE_STATES.has(item.state));

    // Leaving the page would cut off the running upload and drop the queue.
    useEffect(() => {
        if (!active) return undefined;
        const warn = event => {
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [active]);

    // Logging out unmounts the provider; stop what is still sending.
    useEffect(() => () => {
        for (const controller of controllers.current.values()) controller.abort();
    }, []);

    /**
     * Queues files for one destination.
     *   target  { caseId } or { categoryId } (a category without a case)
     *   label   destination name shown in the tray; link: where that name points
     */
    const addFiles = useCallback((fileList, { target, label, link }) => {
        const added = [...fileList].map(file => {
            const allowed = ALLOWED.test(file.name);
            return {
                id: nextId++,
                file,
                target,
                label,
                link,
                name: file.name,
                size: file.size,
                percent: 0,
                loaded: 0,
                state: allowed ? 'queued' : 'error',
                error: allowed ? null : 'Format tidak didukung (.svs, .tif, .tiff).',
            };
        });
        if (!added.length) return;
        setItems(current => [...current, ...added]);
        setMinimized(false);
    }, []);

    const cancel = useCallback(id => {
        const controller = controllers.current.get(id);
        // "cancel" also deletes the partial upload on the server.
        if (controller) controller.abort('cancel');
        else update(id, { state: 'cancelled' });
    }, [update]);

    const retry = useCallback(id => update(id, { state: 'queued', percent: 0, loaded: 0, error: null }), [update]);

    const clearFinished = useCallback(() => {
        setItems(current => current.filter(item => ACTIVE_STATES.has(item.state)));
    }, []);

    const value = useMemo(() => ({ addFiles }), [addFiles]);
    const itemsValue = useMemo(() => ({ items, cancel, retry }), [items, cancel, retry]);

    return (
        <UploadQueueContext.Provider value={value}>
            <UploadItemsContext.Provider value={itemsValue}>
                {children}
            </UploadItemsContext.Provider>
            {items.length > 0 && (
                <UploadTray items={items} minimized={minimized} onToggleMinimized={() => setMinimized(current => !current)}
                    onCancel={cancel} onRetry={retry} onClear={clearFinished} />
            )}
        </UploadQueueContext.Provider>
    );
}

export function useUploadQueue() {
    return useContext(UploadQueueContext);
}

/** { items, cancel(id), retry(id) } of this tab's upload queue, live with progress. */
export function useUploadItems() {
    return useContext(UploadItemsContext);
}

const STATE_ICONS = {
    queued: 'far fa-clock',
    uploading: 'fas fa-arrow-up',
    done: 'fas fa-check-circle',
    warning: 'fas fa-exclamation-triangle',
    error: 'fas fa-times-circle',
    cancelled: 'fas fa-ban',
};

function statusText(item) {
    switch (item.state) {
        case 'queued': return t('Menunggu');
        case 'uploading':
            if (item.retrying) return t('Koneksi terputus, mencoba lagi ({n})…', { n: item.retrying });
            return `${item.percent}% · ${formatBytes(item.loaded)} / ${formatBytes(item.size)}${item.resumedFrom ? ` · ${t('dilanjutkan')}` : ''}`;
        case 'done': return t('Siap dilihat');
        case 'cancelled': return t('Dibatalkan');
        default: return t(item.error);
    }
}

function UploadTray({ items, minimized, onToggleMinimized, onCancel, onRetry, onClear }) {
    const counted = items.filter(item => item.state !== 'cancelled');
    const finished = counted.filter(item => FINISHED_STATES.has(item.state)).length;
    const failed = counted.filter(item => item.state === 'error' || item.state === 'warning').length;
    const uploading = items.find(item => item.state === 'uploading');
    const active = items.some(item => ACTIVE_STATES.has(item.state));

    const title = active
        ? t('Mengunggah {current} dari {total}', { current: Math.min(finished + 1, counted.length), total: counted.length })
        : failed ? t('Upload selesai, {n} bermasalah', { n: failed }) : t('Upload selesai');

    return (
        <section className="upload-tray" aria-label={t('Antrian upload')}>
            <header className="upload-tray-header">
                <span className="upload-tray-title">{title}</span>
                <button type="button" className="upload-tray-btn" onClick={onToggleMinimized}
                    aria-expanded={!minimized} title={minimized ? t('Tampilkan') : t('Sembunyikan')}>
                    <i className={`fas fa-chevron-${minimized ? 'up' : 'down'}`} aria-hidden="true" />
                </button>
                {!active && (
                    <button type="button" className="upload-tray-btn" onClick={onClear} title={t('Tutup')}>
                        <i className="fas fa-times" aria-hidden="true" />
                    </button>
                )}
            </header>

            {minimized ? (
                uploading && (
                    <div className="progress upload-tray-overall" style={{ height: 3 }}>
                        <div className="progress-bar" style={{ width: `${uploading.percent}%` }} />
                    </div>
                )
            ) : (
                <ul className="upload-tray-list">
                    {items.map(item => (
                        <li key={item.id} className={`upload-tray-item is-${item.state}`}>
                            <i className={`${STATE_ICONS[item.state]} upload-tray-icon`} aria-hidden="true" />
                            <div className="upload-tray-body">
                                <div className="upload-tray-name" title={item.name}>{item.name}</div>
                                <div className="upload-tray-meta">
                                    <span className="upload-tray-status">{statusText(item)}</span>
                                    <span aria-hidden="true">·</span>
                                    <Link to={item.link} className="upload-tray-case">{item.label}</Link>
                                </div>
                                {item.state === 'uploading' && (
                                    <div className="progress mt-1" style={{ height: 4 }}>
                                        <div className="progress-bar" style={{ width: `${item.percent}%` }} />
                                    </div>
                                )}
                            </div>
                            {ACTIVE_STATES.has(item.state) && (
                                <button type="button" className="upload-tray-btn" onClick={() => onCancel(item.id)} title={t('Batalkan')}>
                                    <i className="fas fa-times" aria-hidden="true" />
                                </button>
                            )}
                            {(item.state === 'error' || item.state === 'cancelled') && ALLOWED.test(item.name) && (
                                <button type="button" className="upload-tray-btn" onClick={() => onRetry(item.id)} title={t('Coba lagi')}>
                                    <i className="fas fa-redo" aria-hidden="true" />
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
