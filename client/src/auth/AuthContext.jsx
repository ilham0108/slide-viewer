import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, SESSION_EXPIRED_EVENT } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        try {
            const data = await api('/auth/me');
            setUser(data.user);
        } catch {
            setUser(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    useEffect(() => {
        const onExpired = () => setUser(null);
        window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
        return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    }, []);

    const login = useCallback(async (username, password) => {
        await api('/auth/login', { method: 'POST', body: { username, password } });
        await refresh();
    }, [refresh]);

    const logout = useCallback(async () => {
        try {
            await api('/auth/logout', { method: 'POST' });
        } finally {
            setUser(null);
        }
    }, []);

    const value = useMemo(() => {
        const permissions = new Set(user?.permissions || []);
        return {
            user,
            loading,
            login,
            logout,
            refresh,
            /** True when the user has at least one of the given permissions. */
            can: (...keys) => keys.some(key => permissions.has(key)),
        };
    }, [user, loading, login, logout, refresh]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    return useContext(AuthContext);
}
