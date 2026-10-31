import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, LoadingState } from './States';
import { t } from '../i18n';

export function RequireAuth({ children }) {
    const { user, loading } = useAuth();
    const location = useLocation();
    if (loading) return <LoadingState message={t('Memuat…')} fullScreen />;
    if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
    return children;
}

export function RequirePermission({ permissions, children }) {
    const { can } = useAuth();
    if (!can(...permissions)) {
        return (
            <div className="page">
                <EmptyState icon="fa-lock" message={t('Anda tidak memiliki akses ke halaman ini.')} />
            </div>
        );
    }
    return children;
}

/** For users whose role cannot view slides (the start page): the first page they can open. */
export function HomeRedirect() {
    const { can } = useAuth();
    if (can('cases.view')) return <Navigate to="/cases" replace />;
    return <Navigate to="/account" replace />;
}
