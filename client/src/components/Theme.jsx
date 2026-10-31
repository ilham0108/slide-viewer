import { createContext, useCallback, useContext, useEffect, useState } from 'react';

// Per browser: 'light', 'dark', or 'system' (follows the operating system, live).
const STORAGE_KEY = 'ui-theme';
export const THEMES = ['light', 'dark', 'system'];

function readStoredTheme() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (THEMES.includes(stored)) return stored;
    } catch {
        // Storage blocked: follow the system.
    }
    return 'system';
}

const systemQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

/** Applies the resolved theme to <html>: our tokens use data-theme, Bootstrap uses data-bs-theme. */
function applyTheme(preference) {
    const resolved = preference === 'system' ? (systemQuery().matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.bsTheme = resolved;
    return resolved;
}

const ThemeContext = createContext({ theme: 'system', resolvedTheme: 'light', setTheme: () => {} });

export function ThemeProvider({ children }) {
    const [theme, setThemeState] = useState(readStoredTheme);
    const [resolvedTheme, setResolvedTheme] = useState(() => applyTheme(readStoredTheme()));

    useEffect(() => {
        setResolvedTheme(applyTheme(theme));
        if (theme !== 'system') return undefined;
        const query = systemQuery();
        const onChange = () => setResolvedTheme(applyTheme('system'));
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }, [theme]);

    const setTheme = useCallback(next => {
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // The choice then lasts for this visit only.
        }
        setThemeState(next);
    }, []);

    return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
    return useContext(ThemeContext);
}
