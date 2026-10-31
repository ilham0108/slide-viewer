import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { copyText, shareUrl } from '../components/ShareDialog';
import { EmptyState, LoadingState, PageHeader } from '../components/States';
import { useToast } from '../components/Toast';
import { formatDate } from '../utils/format';
import { t } from '../i18n';

const TYPE_INFO = {
    slide: { icon: 'fa-image', label: 'Slide' },
    case: { icon: 'fa-file-medical', label: 'Case' },
    category: { icon: 'fa-folder', label: 'Kategori' },
    compare: { icon: 'fa-columns', label: 'Perbandingan' },
    slides: { icon: 'fa-images', label: 'Slide pilihan' },
    cases: { icon: 'fa-copy', label: 'Case pilihan' },
};

const STATUS_INFO = {
    active: { label: 'Aktif', className: 'status-closed' },
    expired: { label: 'Kedaluwarsa', className: 'status-in_review' },
    revoked: { label: 'Dicabut', className: 'status-revoked' },
};

export default function SharesPage() {
    const toast = useToast();
    const [data, setData] = useState(null);
    const [showAll, setShowAll] = useState(false);
    const [statusFilter, setStatusFilter] = useState('active');

    const load = useCallback(async () => {
        try {
            setData(await api(`/shares${showAll ? '?all=1' : ''}`));
        } catch (error) {
            toast(error.message, 'error');
            setData({ shares: [], canManageAll: false });
        }
    }, [showAll, toast]);

    useEffect(() => {
        load();
    }, [load]);

    const revoke = async share => {
        if (!window.confirm(t('Cabut link "{name}"? Penerima tidak akan bisa membukanya lagi.', { name: share.title }))) return;
        try {
            await api(`/shares/${share.id}`, { method: 'DELETE' });
            toast('Link dicabut.', 'success');
            load();
        } catch (error) {
            toast(error.message, 'error');
        }
    };

    const shares = data?.shares.filter(share => !statusFilter || share.status === statusFilter);

    return (
        <div className="page">
            <PageHeader
                title={t('Link Berbagi')}
                subtitle={t('Link publik hanya-lihat yang pernah dibuat. Cabut link agar tidak bisa dibuka lagi.')}
            />

            <div className="toolbar">
                <div className="segmented" role="group" aria-label={t('Filter status')}>
                    {[['active', 'Aktif'], ['expired', 'Kedaluwarsa'], ['revoked', 'Dicabut'], ['', 'Semua']].map(([value, label]) => (
                        <button key={label} type="button" className={statusFilter === value ? 'active' : ''} onClick={() => setStatusFilter(value)}>{t(label)}</button>
                    ))}
                </div>
                {data?.canManageAll && (
                    <div className="form-check form-switch mb-0">
                        <input id="showAllShares" type="checkbox" className="form-check-input" checked={showAll} onChange={event => setShowAll(event.target.checked)} />
                        <label className="form-check-label" htmlFor="showAllShares">{t('Tampilkan link semua user')}</label>
                    </div>
                )}
                {shares && <span className="toolbar-count">{t('{n} link', { n: shares.length })}</span>}
            </div>

            {!shares ? <LoadingState /> : !shares.length ? (
                <EmptyState icon="fa-share-alt" message={statusFilter === 'active' ? 'Tidak ada link aktif' : 'Tidak ada link'}
                    description={t('Buat link dari tombol Bagikan di viewer, halaman case, galeri kategori, atau tampilan Bandingkan.')} />
            ) : (
                <div className="panel">
                    <div className="table-responsive">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>{t('Link')}</th>
                                    <th>{t('Pengaman')}</th>
                                    <th>{t('Berlaku sampai')}</th>
                                    <th className="text-end">{t('Dibuka')}</th>
                                    {showAll && <th className="hide-md">{t('Dibuat oleh')}</th>}
                                    <th>{t('Status')}</th>
                                    <th aria-label={t('Aksi')} />
                                </tr>
                            </thead>
                            <tbody>
                                {shares.map(share => {
                                    const type = TYPE_INFO[share.type];
                                    const status = STATUS_INFO[share.status];
                                    return (
                                        <tr key={share.id}>
                                            <td>
                                                <div className="share-cell">
                                                    <span className="share-type-icon" title={t(type.label)}><i className={`fas ${type.icon}`} aria-hidden="true" /></span>
                                                    <span>
                                                        <span className="case-number">{share.title}</span>
                                                        <span className="case-title d-block">
                                                            {t(type.label)}
                                                            {share.targetName && share.targetName !== share.title ? ` · ${share.targetName.replace(/\.(svs|tiff?)$/i, '')}` : ''}
                                                            {' · '}{t('dibuat {date}', { date: formatDate(share.createdAt) })}
                                                        </span>
                                                    </span>
                                                </div>
                                            </td>
                                            <td>
                                                <div className="share-flags">
                                                    {share.hasPassword && <span title={t('Dilindungi password')}><i className="fas fa-lock" aria-hidden="true" />{' '}{t('Password')}</span>}
                                                    {share.hideClinical && <span title={t('Catatan klinis disembunyikan')}><i className="fas fa-eye-slash" aria-hidden="true" />{' '}{t('Klinis')}</span>}
                                                    {share.hasViewState && <span title={t('Membuka posisi tertentu')}><i className="fas fa-crosshairs" aria-hidden="true" />{' '}{t('Posisi')}</span>}
                                                    {!share.showAnnotations && <span title={t('Anotasi tidak ditampilkan')}><i className="fas fa-draw-polygon" aria-hidden="true" />{' '}{t('Tanpa anotasi')}</span>}
                                                    {share.allowAnnotationEdit && <span title={t('Penerima dapat mengedit anotasi')}><i className="fas fa-pen" aria-hidden="true" />{' '}{t('Edit anotasi')}</span>}
                                                    {!share.hasPassword && !share.hideClinical && !share.hasViewState && share.showAnnotations && !share.allowAnnotationEdit && <span className="text-muted-2">—</span>}
                                                </div>
                                            </td>
                                            <td className="text-nowrap">{share.expiresAt ? formatDate(share.expiresAt, true) : 'Tanpa batas'}</td>
                                            <td className="text-end tabular">
                                                {share.viewCount}
                                                {share.lastViewedAt && <div className="small text-muted-2">{t('terakhir {date}', { date: formatDate(share.lastViewedAt) })}</div>}
                                            </td>
                                            {showAll && <td className="hide-md">{share.createdBy || '—'}</td>}
                                            <td><span className={`status-badge ${status.className}`}>{t(status.label)}</span></td>
                                            <td className="text-end text-nowrap">
                                                {share.status === 'active' && (
                                                    <>
                                                        <button type="button" className="btn btn-sm btn-light me-1" title={t('Salin link')}
                                                            onClick={async () => toast(await copyText(shareUrl(share)) ? 'Link disalin.' : 'Gagal menyalin.', 'success')}>
                                                            <i className="far fa-copy" aria-hidden="true" /><span className="visually-hidden">{t('Salin')}</span>
                                                        </button>
                                                        <a className="btn btn-sm btn-light me-1" href={shareUrl(share)} target="_blank" rel="noreferrer" title={t('Buka')}>
                                                            <i className="fas fa-external-link-alt" aria-hidden="true" /><span className="visually-hidden">{t('Buka')}</span>
                                                        </a>
                                                        <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => revoke(share)}>{t('Cabut')}</button>
                                                    </>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
