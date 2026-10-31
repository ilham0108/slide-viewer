import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import Modal from './Modal';
import { ACCEPTED_SLIDE_FILES, useUploadQueue } from './UploadQueue';
import { caseLabel, formatBytes } from '../utils/format';
import { t } from '../i18n';

const ALLOWED = /\.(svs|tiff?)$/i;

/**
 * Chooses files and where they go: into a case, or straight into a category (a slide
 * without a case). The files then upload through the app-wide queue.
 *
 * initialTarget: { type: 'case' | 'category', id } to preselect a destination.
 */
export default function UploadDialog({ initialTarget, onClose }) {
    const { can } = useAuth();
    const uploads = useUploadQueue();
    const inputRef = useRef(null);
    const canChooseCase = can('cases.view');
    const [type, setType] = useState(initialTarget?.type || (canChooseCase ? 'case' : 'category'));
    const [caseId, setCaseId] = useState(initialTarget?.type === 'case' ? String(initialTarget.id) : '');
    const [categoryId, setCategoryId] = useState(initialTarget?.type === 'category' ? String(initialTarget.id) : '');
    const [cases, setCases] = useState([]);
    const [categories, setCategories] = useState([]);
    const [files, setFiles] = useState([]);
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
        if (canChooseCase) api('/cases').then(data => setCases(data.cases)).catch(() => {});
        api('/categories').then(data => setCategories(data.categories)).catch(() => {});
    }, [canChooseCase]);

    // Cases grouped by category for the dropdown.
    const caseGroups = useMemo(() => {
        const groups = new Map();
        for (const item of cases) {
            const label = item.category?.name || t('Tanpa kategori');
            if (!groups.has(label)) groups.set(label, []);
            groups.get(label).push(item);
        }
        return [...groups.entries()];
    }, [cases]);

    const addFiles = fileList => {
        const incoming = [...fileList];
        setFiles(current => {
            const known = new Set(current.map(file => `${file.name}:${file.size}`));
            return [...current, ...incoming.filter(file => !known.has(`${file.name}:${file.size}`))];
        });
    };

    const validFiles = files.filter(file => ALLOWED.test(file.name));
    const chosenCase = cases.find(item => String(item.id) === caseId);
    const chosenCategory = categories.find(item => String(item.id) === categoryId);
    const destinationReady = type === 'case' ? Boolean(chosenCase) : Boolean(chosenCategory);

    const submit = () => {
        if (!destinationReady || !validFiles.length) return;
        const destination = type === 'case'
            ? { target: { caseId: chosenCase.id }, label: caseLabel(chosenCase), link: `/cases/${chosenCase.id}` }
            : { target: { categoryId: chosenCategory.id }, label: chosenCategory.name, link: `/?category=${chosenCategory.id}&case=none` };
        uploads.addFiles(validFiles, destination);
        onClose();
    };

    return (
        <Modal
            title="Unggah slide"
            size="lg"
            onClose={onClose}
            onSubmit={submit}
            footer={(
                <>
                    <button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('Batal')}</button>
                    <button type="submit" className="btn btn-primary" disabled={!destinationReady || !validFiles.length}>
                        <i className="fas fa-cloud-upload-alt me-2" aria-hidden="true" />
                        {t('Unggah {n} file', { n: validFiles.length })}
                    </button>
                </>
            )}
        >
            <div className="mb-3">
                <div className="form-label fw-semibold">{t('Tujuan')}</div>
                <div className="upload-target-options">
                    {canChooseCase && (
                        <label className={`upload-target-option${type === 'case' ? ' is-active' : ''}`}>
                            <input type="radio" name="upload-target" checked={type === 'case'} onChange={() => setType('case')} />
                            <i className="fas fa-file-medical" aria-hidden="true" />
                            <span>
                                <strong>{t('Ke dalam case')}</strong>
                                <small>{t('Slide menjadi bagian dari sebuah case.')}</small>
                            </span>
                        </label>
                    )}
                    <label className={`upload-target-option${type === 'category' ? ' is-active' : ''}`}>
                        <input type="radio" name="upload-target" checked={type === 'category'} onChange={() => setType('category')} />
                        <i className="fas fa-folder" aria-hidden="true" />
                        <span>
                            <strong>{t('Ke dalam kategori')}</strong>
                            <small>{t('Langsung di kategori, tanpa case.')}</small>
                        </span>
                    </label>
                </div>
            </div>

            <div className="mb-3">
                {type === 'case' ? (
                    <>
                        <label className="form-label" htmlFor="upload-case">{t('Case')}</label>
                        <select id="upload-case" className="form-select" value={caseId} onChange={event => setCaseId(event.target.value)}>
                            <option value="">{t('— Pilih case —')}</option>
                            {caseGroups.map(([label, items]) => (
                                <optgroup key={label} label={label}>
                                    {items.map(item => <option key={item.id} value={item.id}>{caseLabel(item)}</option>)}
                                </optgroup>
                            ))}
                        </select>
                    </>
                ) : (
                    <>
                        <label className="form-label" htmlFor="upload-category">{t('Kategori')}</label>
                        <select id="upload-category" className="form-select" value={categoryId} onChange={event => setCategoryId(event.target.value)}>
                            <option value="">{t('— Pilih kategori —')}</option>
                            {categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                        {!categories.length && <div className="form-text">{t('Belum ada kategori.')}</div>}
                    </>
                )}
            </div>

            <div
                className={`upload-dropzone${dragging ? ' is-dragging' : ''}`}
                onDragOver={event => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={event => {
                    event.preventDefault();
                    setDragging(false);
                    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
                }}
            >
                <i className="fas fa-cloud-upload-alt" aria-hidden="true" />
                <div>
                    <strong>{t('Seret file ke sini')}</strong>{' '}{t('atau')}{' '}
                    <button type="button" className="btn btn-link p-0 align-baseline" onClick={() => inputRef.current.click()}>{t('pilih file')}</button>
                    <div className="small text-muted">{t('.svs, .tif, .tiff · maksimal 5 GB per file')}</div>
                </div>
                <input ref={inputRef} type="file" accept={ACCEPTED_SLIDE_FILES} multiple hidden
                    onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
            </div>

            {files.length > 0 && (
                <ul className="upload-file-list">
                    {files.map(file => {
                        const allowed = ALLOWED.test(file.name);
                        return (
                            <li key={`${file.name}:${file.size}`} className={allowed ? undefined : 'is-invalid'}>
                                <i className={`far ${allowed ? 'fa-file-image' : 'fa-times-circle'}`} aria-hidden="true" />
                                <span className="upload-file-name" title={file.name}>{file.name}</span>
                                <span className="upload-file-size">{allowed ? formatBytes(file.size) : t('Format tidak didukung')}</span>
                                <button type="button" className="btn btn-sm btn-link text-muted" aria-label={t('Hapus dari daftar')}
                                    onClick={() => setFiles(current => current.filter(item => item !== file))}>
                                    <i className="fas fa-times" aria-hidden="true" />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </Modal>
    );
}
