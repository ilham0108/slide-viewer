import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { EN_MESSAGES, EN_PATTERNS } from './en';

// The Indonesian text in the code is the key; English comes from en.js. Missing English
// entries fall back to the Indonesian text, so a forgotten string is never blank.
export const LANGUAGES = [
    { code: 'id', label: 'Bahasa Indonesia', short: 'ID' },
    { code: 'en', label: 'English', short: 'EN' },
];
const STORAGE_KEY = 'ui-language';

// Read by non-React helpers (date formatting, API error messages).
let currentLang = readStoredLanguage();

function readStoredLanguage() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (LANGUAGES.some(language => language.code === stored)) return stored;
    } catch {
        // Storage blocked: use the default.
    }
    return 'id';
}

export function getLanguage() {
    return currentLang;
}

export function getLocale() {
    return currentLang === 'en' ? 'en-GB' : 'id-ID';
}

function interpolate(template, vars) {
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, key) => (vars[key] !== undefined ? String(vars[key]) : match));
}

/** Translates an Indonesian source text. `vars.n` picks { one, other } plural forms. */
export function translate(text, vars, lang = currentLang) {
    if (text === undefined || text === null) return text;
    let template = text;
    if (lang === 'en') {
        const entry = EN_MESSAGES[text];
        if (typeof entry === 'string') template = entry;
        else if (entry && typeof entry === 'object') template = vars?.n === 1 ? entry.one : entry.other;
    }
    return interpolate(template, vars);
}

/**
 * Shorthand for components: `t('Simpan')`. Switching language remounts the app (see
 * LanguageProvider), so every t() call runs again with the new language.
 */
export function t(text, vars) {
    return translate(text, vars);
}

/** Server messages: exact matches first, then patterns for messages that contain numbers or names. */
export function translateServerMessage(message) {
    if (!message || currentLang !== 'en') return message;
    if (typeof EN_MESSAGES[message] === 'string') return EN_MESSAGES[message];
    for (const [pattern, replacement] of EN_PATTERNS) {
        if (pattern.test(message)) return message.replace(pattern, replacement);
    }
    return message;
}

const I18nContext = createContext({ lang: currentLang, setLang: () => {}, t: translate });

export function LanguageProvider({ children }) {
    const [lang, setLangState] = useState(currentLang);

    const setLang = useCallback(next => {
        if (next === currentLang) return;
        // Remounting discards unsaved work (e.g. annotations), so ask first.
        if (document.querySelector('[data-unsaved="true"]')
            && !window.confirm(translate('Ada perubahan yang belum disimpan. Ganti bahasa sekarang? Perubahan tersebut akan hilang.'))) {
            return;
        }
        currentLang = next;
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // The choice then lasts for this visit only.
        }
        setLangState(next);
    }, []);

    useEffect(() => {
        document.documentElement.lang = lang;
    }, [lang]);

    const value = useMemo(() => ({
        lang,
        setLang,
        t: (text, vars) => translate(text, vars, lang),
    }), [lang, setLang]);

    // Keyed by language: the whole app re-renders, so plain t() calls pick up the change.
    return <I18nContext.Provider value={value}><Fragment key={lang}>{children}</Fragment></I18nContext.Provider>;
}

export function useI18n() {
    return useContext(I18nContext);
}
