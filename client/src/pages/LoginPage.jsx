import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { BrandMark, useBranding, useDocumentTitle } from '../components/Branding';
import PreferenceControls from '../components/Preferences';
import { t, useI18n } from '../i18n';

export default function LoginPage() {
    const { user, loading, login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const { branding } = useBranding();
    const { t } = useI18n();
    useDocumentTitle(t('Masuk'));

    if (!loading && user) return <Navigate to={location.state?.from?.pathname || '/'} replace />;

    const handleSubmit = async event => {
        event.preventDefault();
        setError('');
        setSubmitting(true);
        try {
            await login(username.trim(), password);
            navigate(location.state?.from?.pathname || '/', { replace: true });
        } catch (loginError) {
            setError(loginError.message);
            setPassword('');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="login-screen">
            <form className="login-card" onSubmit={handleSubmit}>
                <div className="login-brand">
                    <BrandMark />
                    <div>
                        <h1>{branding.appName}</h1>
                        {branding.appSubtitle && <p>{branding.appSubtitle}</p>}
                    </div>
                </div>
                {error && <div className="alert alert-danger py-2" role="alert">{error}</div>}
                <div className="mb-3">
                    <label className="form-label" htmlFor="username">{t('Username')}</label>
                    <input id="username" className="form-control" autoComplete="username" autoFocus required
                        value={username} onChange={event => setUsername(event.target.value)} />
                </div>
                <div className="mb-4">
                    <label className="form-label" htmlFor="password">{t('Password')}</label>
                    <input id="password" type="password" className="form-control" autoComplete="current-password" required
                        value={password} onChange={event => setPassword(event.target.value)} />
                </div>
                <button type="submit" className="btn btn-primary w-100" disabled={submitting || !username || !password}>
                    {submitting ? t('Memproses…') : t('Masuk')}
                </button>
                <div className="login-preferences">
                    <PreferenceControls compact />
                </div>
            </form>
        </div>
    );
}
