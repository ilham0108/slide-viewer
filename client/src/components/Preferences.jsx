import { LANGUAGES, useI18n } from '../i18n';
import { useTheme } from './Theme';

const THEME_OPTIONS = [
    { value: 'light', icon: 'fa-sun', label: 'Terang' },
    { value: 'dark', icon: 'fa-moon', label: 'Gelap' },
    { value: 'system', icon: 'fa-desktop', label: 'Ikuti sistem' },
];

/** Theme and language pickers; used in the account menu and on the login page. */
export default function PreferenceControls({ compact = false }) {
    const { theme, setTheme } = useTheme();
    const { lang, setLang, t } = useI18n();

    return (
        <div className={`preferences${compact ? ' is-compact' : ''}`}>
            <div className="preference-row">
                {!compact && <span className="preference-label">{t('Tema')}</span>}
                <div className="segmented segmented-icons" role="radiogroup" aria-label={t('Tema')}>
                    {THEME_OPTIONS.map(option => (
                        <button key={option.value} type="button" role="radio" aria-checked={theme === option.value}
                            className={theme === option.value ? 'active' : ''} title={t(option.label)}
                            onClick={() => setTheme(option.value)}>
                            <i className={`fas ${option.icon}`} aria-hidden="true" />
                            {!compact && <span>{t(option.label)}</span>}
                        </button>
                    ))}
                </div>
            </div>
            <div className="preference-row">
                {!compact && <span className="preference-label">{t('Bahasa')}</span>}
                <div className="segmented" role="radiogroup" aria-label={t('Bahasa')}>
                    {LANGUAGES.map(language => (
                        <button key={language.code} type="button" role="radio" aria-checked={lang === language.code}
                            className={lang === language.code ? 'active' : ''} title={language.label}
                            onClick={() => setLang(language.code)}>
                            {compact ? language.short : language.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
