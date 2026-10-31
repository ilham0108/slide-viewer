import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { BrandMark, useBranding, useDocumentTitle } from './Branding';
import { useSlideSelection } from './CompareBar';
import PreferenceControls from './Preferences';
import { UploadQueueProvider } from './UploadQueue';
import { useI18n } from '../i18n';

const MAIN_NAV = [
    { to: '/', end: true, icon: 'fa-images', label: 'Slide', permissions: ['slides.view'] },
    { to: '/cases', icon: 'fa-folder-open', label: 'Case', permissions: ['cases.view'] },
    { to: '/compare', icon: 'fa-columns', label: 'Bandingkan', permissions: ['slides.view'] },
    { to: '/uploads', icon: 'fa-cloud-upload-alt', label: 'Upload', permissions: ['slides.upload', 'slides.delete'] },
    { to: '/shares', icon: 'fa-share-alt', label: 'Link Berbagi', permissions: ['shares.create', 'shares.manage'] },
];

const ADMIN_NAV = [
    { to: '/categories', icon: 'fa-tags', label: 'Kategori', description: 'Kelompok case', permissions: ['categories.manage'] },
    { to: '/users', icon: 'fa-users', label: 'User', description: 'Akun dan status', permissions: ['users.manage'] },
    { to: '/roles', icon: 'fa-user-shield', label: 'Role & Permission', description: 'Hak akses', permissions: ['roles.manage'] },
];

// Viewer and compare pages fill the window below the header.
const IMMERSIVE_PATHS = /^\/(viewer|compare)(\/|$)/;

function Dropdown({ open, onClose, children, align = 'end' }) {
    if (!open) return null;
    return (
        <>
            <div className="menu-backdrop" onClick={onClose} />
            <div className={`menu menu-${align}`} role="menu">{children}</div>
        </>
    );
}

export default function AppLayout() {
    const { user, can, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const immersive = IMMERSIVE_PATHS.test(location.pathname);
    const [openMenu, setOpenMenu] = useState(null);
    const selection = useSlideSelection();
    const { branding } = useBranding();
    const { t } = useI18n();
    useDocumentTitle();

    useEffect(() => {
        setOpenMenu(null);
    }, [location.pathname, location.search]);

    const mainItems = MAIN_NAV.filter(item => can(...item.permissions));
    const adminItems = ADMIN_NAV.filter(item => can(...item.permissions));
    const adminActive = adminItems.some(item => location.pathname.startsWith(item.to));
    const toggle = name => setOpenMenu(current => (current === name ? null : name));

    const handleLogout = async () => {
        await logout();
        selection.clear();
        navigate('/login', { replace: true });
    };

    return (
        <div className={`app${immersive ? ' is-immersive' : ''}`}>
            <header className="app-header">
                <Link to="/" className="brand">
                    <BrandMark />
                    <span className="brand-text">
                        <span className="brand-name">{branding.appName}</span>
                        {branding.appSubtitle && <span className="brand-sub">{branding.appSubtitle}</span>}
                    </span>
                </Link>

                <nav className="main-nav" aria-label={t('Navigasi utama')}>
                    {mainItems.map(item => (
                        <NavLink key={item.to} to={item.to} end={item.end} className="main-nav-link">
                            <i className={`fas ${item.icon}`} aria-hidden="true" />
                            <span>{t(item.label)}</span>
                        </NavLink>
                    ))}
                    {adminItems.length > 0 && (
                        <div className="nav-dropdown">
                            <button type="button" className={`main-nav-link${adminActive ? ' active' : ''}`}
                                aria-expanded={openMenu === 'admin'} onClick={() => toggle('admin')}>
                                <i className="fas fa-sliders-h" aria-hidden="true" />
                                <span>{t('Administrasi')}</span>
                                <i className="fas fa-chevron-down caret" aria-hidden="true" />
                            </button>
                            <Dropdown open={openMenu === 'admin'} onClose={() => setOpenMenu(null)} align="start">
                                {adminItems.map(item => (
                                    <NavLink key={item.to} to={item.to} className="menu-item menu-item-rich" role="menuitem">
                                        <span className="menu-icon"><i className={`fas ${item.icon}`} aria-hidden="true" /></span>
                                        <span>
                                            <span className="menu-title">{t(item.label)}</span>
                                            <span className="menu-desc">{t(item.description)}</span>
                                        </span>
                                    </NavLink>
                                ))}
                            </Dropdown>
                        </div>
                    )}
                </nav>

                <div className="header-end">
                    <button type="button" className="icon-btn mobile-nav-toggle" aria-label={t('Menu')}
                        aria-expanded={openMenu === 'mobile'} onClick={() => toggle('mobile')}>
                        <i className="fas fa-bars" aria-hidden="true" />
                    </button>
                    <div className="nav-dropdown">
                        <button type="button" className="user-btn" aria-expanded={openMenu === 'user'} onClick={() => toggle('user')}>
                            <span className="avatar">{(user?.name || '?').slice(0, 1).toUpperCase()}</span>
                            <span className="user-text">
                                <span className="user-name">{user?.name}</span>
                                <span className="user-role">{user?.roleName}</span>
                            </span>
                            <i className="fas fa-chevron-down caret" aria-hidden="true" />
                        </button>
                        <Dropdown open={openMenu === 'user'} onClose={() => setOpenMenu(null)}>
                            <div className="menu-header">
                                <div className="menu-title">{user?.name}</div>
                                <div className="menu-desc">@{user?.username} · {user?.roleName}</div>
                            </div>
                            <div className="menu-section">
                                <PreferenceControls />
                            </div>
                            <NavLink to="/account" className="menu-item" role="menuitem">
                                <i className="fas fa-key" aria-hidden="true" /> {t('Ganti password')}
                            </NavLink>
                            <button type="button" className="menu-item" role="menuitem" onClick={handleLogout}>
                                <i className="fas fa-sign-out-alt" aria-hidden="true" /> {t('Keluar')}
                            </button>
                        </Dropdown>
                    </div>
                </div>

                {openMenu === 'mobile' && (
                    <nav className="mobile-nav" aria-label={t('Navigasi utama')}>
                        {[...mainItems, ...adminItems].map(item => (
                            <NavLink key={item.to} to={item.to} end={item.end} className="mobile-nav-link">
                                <i className={`fas ${item.icon}`} aria-hidden="true" /> {t(item.label)}
                            </NavLink>
                        ))}
                    </nav>
                )}
            </header>

            <main className="app-main">
                <UploadQueueProvider>
                    <Outlet />
                </UploadQueueProvider>
            </main>
        </div>
    );
}
