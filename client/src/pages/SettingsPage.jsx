import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { translateServerMessage } from '../i18n';
import { BrandMark, useBranding } from '../components/Branding';
import { PageHeader } from '../components/States';
import { useToast } from '../components/Toast';
import { t } from '../i18n';

async function uploadLogo(file) {
    const formData = new FormData();
    formData.append('logo', file);
    const response = await fetch('/api/settings/logo', { method: 'POST', body: formData });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(data.message ? translateServerMessage(data.message) : t('Upload gagal ({status}).', { status: response.status }), response.status, data);
    return data;
}

export default function SettingsPage() {
    const toast = useToast();
    const { branding, setBranding } = useBranding();
    const fileRef = useRef(null);
    const [form, setForm] = useState({ appName: branding.appName, appSubtitle: branding.appSubtitle });
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');

    // The branding may arrive after the page first renders.
    useEffect(() => {
        setForm({ appName: branding.appName, appSubtitle: branding.appSubtitle });
    }, [branding.appName, branding.appSubtitle]);

    const save = async event => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            const data = await api('/settings', { method: 'PUT', body: form });
            setBranding(data.settings);
            toast('Pengaturan disimpan.', 'success');
        } catch (saveError) {
            setError(saveError.message);
        } finally {
            setSaving(false);
        }
    };

    const onFile = async event => {
        const file = event.target.files[0];
        event.target.value = '';
        if (!file) return;
        if (file.size > 1024 * 1024) {
            toast('Ukuran logo maksimal 1 MB.', 'error');
            return;
        }
        setUploading(true);
        try {
            const data = await uploadLogo(file);
            setBranding(data.settings);
            toast('Logo diperbarui.', 'success');
        } catch (uploadError) {
            toast(uploadError.message, 'error');
        } finally {
            setUploading(false);
        }
    };

    const removeLogo = async () => {
        if (!window.confirm(t('Hapus logo dan kembali ke ikon bawaan?'))) return;
        try {
            const data = await api('/settings/logo', { method: 'DELETE' });
            setBranding(data.settings);
            toast('Logo dihapus.', 'success');
        } catch (removeError) {
            toast(removeError.message, 'error');
        }
    };

    const dirty = form.appName !== branding.appName || form.appSubtitle !== branding.appSubtitle;

    return (
        <div className="page">
            <PageHeader title={t('Pengaturan')} subtitle={t('Identitas aplikasi yang tampil di halaman login, header, dan link berbagi.')} />

            <div className="settings-layout">
                <form className="panel settings-card" onSubmit={save}>
                    <div className="settings-section">
                        <h2 className="section-title">{t('Logo')}</h2>
                        <div className="logo-row">
                            <BrandMark className="brand-mark-xl" />
                            <div>
                                <div className="d-flex flex-wrap gap-2">
                                    <button type="button" className="btn btn-outline-secondary" disabled={uploading}
                                        onClick={() => fileRef.current.click()}>
                                        <i className="fas fa-upload me-2" aria-hidden="true" />{uploading ? t('Mengunggah…') : t('Unggah logo')}
                                    </button>
                                    {branding.logoUrl && (
                                        <button type="button" className="btn btn-outline-danger" onClick={removeLogo}>{t('Hapus logo')}</button>
                                    )}
                                </div>
                                <div className="form-text mt-2">{t('PNG, JPG, atau WebP, maksimal 1 MB. Gambar persegi (mis. 256 × 256 px) tampil paling baik. Tanpa logo, ikon mikroskop bawaan dipakai.')}</div>
                                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} />
                            </div>
                        </div>
                    </div>

                    <div className="settings-section">
                        <h2 className="section-title">{t('Nama aplikasi')}</h2>
                        {error && <div className="alert alert-danger py-2">{error}</div>}
                        <div className="mb-3">
                            <label className="form-label" htmlFor="appName">{t('Nama')}{' '}<span className="text-danger">*</span></label>
                            <input id="appName" className="form-control" maxLength={60} value={form.appName}
                                onChange={event => setForm({ ...form, appName: event.target.value })} />
                        </div>
                        <div className="mb-3">
                            <label className="form-label" htmlFor="appSubtitle">{t('Subtitle')}</label>
                            <input id="appSubtitle" className="form-control" maxLength={120} value={form.appSubtitle}
                                placeholder={t('mis. Slide Viewer · Laboratorium Patologi Anatomi')}
                                onChange={event => setForm({ ...form, appSubtitle: event.target.value })} />
                        </div>
                        <button type="submit" className="btn btn-primary" disabled={saving || !dirty || !form.appName.trim()}>
                            {saving ? t('Menyimpan…') : t('Simpan')}
                        </button>
                    </div>
                </form>

                <div className="settings-preview">
                    <div className="facts-label mb-2">{t('Pratinjau halaman login')}</div>
                    <div className="login-card login-card-preview">
                        <div className="login-brand">
                            <BrandMark />
                            <div>
                                <h1>{form.appName.trim() || 'Nama aplikasi'}</h1>
                                {form.appSubtitle.trim() && <p>{form.appSubtitle}</p>}
                            </div>
                        </div>
                        <div className="preview-field" />
                        <div className="preview-field" />
                        <div className="preview-button">{t('Masuk')}</div>
                    </div>
                </div>
            </div>
        </div>
    );
}
