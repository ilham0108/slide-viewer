import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/States';
import { useToast } from '../components/Toast';
import PreferenceControls from '../components/Preferences';
import { t, useI18n } from '../i18n';

export default function AccountPage() {
    const { user } = useAuth();
    const toast = useToast();
    const { t } = useI18n();
    const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const set = field => event => setForm({ ...form, [field]: event.target.value });

    const submit = async event => {
        event.preventDefault();
        setError('');
        if (form.newPassword !== form.confirmPassword) {
            setError(t('Konfirmasi password tidak sama.'));
            return;
        }
        setSaving(true);
        try {
            await api('/auth/password', {
                method: 'PUT',
                body: { currentPassword: form.currentPassword, newPassword: form.newPassword },
            });
            setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
            toast('Password berhasil diganti.', 'success');
        } catch (saveError) {
            setError(saveError.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="page">
            <PageHeader title={t('Akun Saya')} subtitle={`${user.name} · ${user.username} · ${user.roleName}`} />
            <section className="panel account-card mb-4">
                <div className="card-body">
                    <h2 className="section-title mt-0">{t('Tampilan')}</h2>
                    <PreferenceControls />
                </div>
            </section>
            <form className="panel account-card" onSubmit={submit}>
                <div className="card-body">
                    <h2 className="section-title mt-0">{t('Ganti password')}</h2>
                    {error && <div className="alert alert-danger py-2">{error}</div>}
                    <div className="mb-3">
                        <label className="form-label" htmlFor="currentPassword">{t('Password saat ini')}</label>
                        <input id="currentPassword" type="password" className="form-control" autoComplete="current-password"
                            value={form.currentPassword} onChange={set('currentPassword')} />
                    </div>
                    <div className="mb-3">
                        <label className="form-label" htmlFor="newPassword">{t('Password baru')}</label>
                        <input id="newPassword" type="password" className="form-control" autoComplete="new-password" maxLength={128}
                            placeholder={t('Minimal 8 karakter')} value={form.newPassword} onChange={set('newPassword')} />
                    </div>
                    <div className="mb-4">
                        <label className="form-label" htmlFor="confirmPassword">{t('Ulangi password baru')}</label>
                        <input id="confirmPassword" type="password" className="form-control" autoComplete="new-password" maxLength={128}
                            value={form.confirmPassword} onChange={set('confirmPassword')} />
                    </div>
                    <button type="submit" className="btn btn-primary"
                        disabled={saving || !form.currentPassword || form.newPassword.length < 8}>
                        {saving ? t('Menyimpan…') : t('Simpan password')}
                    </button>
                </div>
            </form>
        </div>
    );
}
