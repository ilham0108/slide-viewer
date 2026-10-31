import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api';

const DEFAULT_BRANDING = { appName: 'Biozatix', appSubtitle: 'Slide Viewer', logoUrl: null };
const BrandingContext = createContext({ branding: DEFAULT_BRANDING, setBranding: () => {} });

/** Application name, subtitle and logo from the Settings page (readable without login). */
export function BrandingProvider({ children }) {
    const [branding, setBranding] = useState(DEFAULT_BRANDING);

    const load = useCallback(() => {
        api('/public/settings').then(data => setBranding(data.settings)).catch(() => {});
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    // Tab icon follows the logo.
    useEffect(() => {
        const link = document.querySelector('link[rel="icon"]');
        if (link) link.href = branding.logoUrl || 'data:,';
    }, [branding.logoUrl]);

    return <BrandingContext.Provider value={{ branding, setBranding, reload: load }}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
    return useContext(BrandingContext);
}

/** Sets the browser tab title as "<page> · <app name>". */
export function useDocumentTitle(page) {
    const { branding } = useBranding();
    useEffect(() => {
        document.title = page ? `${page} · ${branding.appName}` : `${branding.appName} ${branding.appSubtitle}`.trim();
    }, [page, branding.appName, branding.appSubtitle]);
}

/** The uploaded logo, or the default microscope icon. */
export function BrandMark({ className = '', logoUrl, icon = 'fa-microscope' }) {
    const { branding } = useBranding();
    const src = logoUrl === undefined ? branding.logoUrl : logoUrl;
    if (src) {
        return (
            <span className={`brand-mark has-logo ${className}`}>
                <img src={src} alt="" />
            </span>
        );
    }
    return <span className={`brand-mark ${className}`}><i className={`fas ${icon}`} aria-hidden="true" /></span>;
}
