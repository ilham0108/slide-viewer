import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, matchPath, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, CASES_CHANGED_EVENT } from '../api';
import { useAuth } from '../auth/AuthContext';
import CompareBar from './CompareBar';
import { useI18n } from '../i18n';

const EMPTY_TREE = { totalSlides: 0, unassignedSlides: 0, categories: [], uncategorized: { slideCount: 0, cases: [] } };
// Per browser: whether the sidebar is collapsed to an icon rail.
const COLLAPSED_KEY = 'ui-sidebar-collapsed';

function readStoredCollapsed() {
    try {
        return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
        // Storage blocked: start expanded.
        return false;
    }
}

/**
 * Browsing and administration pages share a folder-like sidebar:
 *   Semua slide
 *   Kategori ▸ cases of that category
 *   Tanpa kategori ▸ cases without a category
 *   Slide tanpa case
 * A category opens the slide gallery filtered to that category (/?category=ID); a case opens
 * its case page. Counts are ready slides.
 */
export default function CategoryLayout() {
    const { can } = useAuth();
    const { t } = useI18n();
    const location = useLocation();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const [tree, setTree] = useState(null);
    const [expanded, setExpanded] = useState(() => new Set());
    const [collapsed, setCollapsed] = useState(readStoredCollapsed);

    const toggleCollapsed = () => {
        const next = !collapsed;
        try {
            localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
        } catch {
            // The choice then lasts for this visit only.
        }
        setCollapsed(next);
    };

    // The tree lists slides and cases; users who can see neither get the page without it.
    const showSidebar = can('slides.view', 'cases.view');

    const load = useCallback(() => {
        api('/browse').then(setTree).catch(() => setTree(EMPTY_TREE));
    }, []);

    useEffect(() => {
        if (!showSidebar) return undefined;
        load();
        window.addEventListener(CASES_CHANGED_EVENT, load);
        return () => window.removeEventListener(CASES_CHANGED_EVENT, load);
    }, [load, showSidebar]);

    // What is selected: the gallery filter on "/", or the case on /cases/:id.
    const onHome = location.pathname === '/';
    const activeCaseId = Number(matchPath('/cases/:caseId', location.pathname)?.params.caseId) || null;
    const activeCategory = onHome ? params.get('category') || '' : null;
    const looseActive = onHome && params.get('case') === 'none';
    // "Belum dikelompokkan": no case and no category.
    const unassignedActive = looseActive && !activeCategory;
    const allActive = onHome && !activeCategory && !params.get('case');

    const groups = tree ? [
        ...tree.categories.map(category => ({ key: String(category.id), ...category })),
        ...(tree.uncategorized.cases.length
            ? [{ key: 'none', name: t('Tanpa kategori'), slideCount: tree.uncategorized.slideCount, looseSlideCount: 0, cases: tree.uncategorized.cases, muted: true }]
            : []),
    ] : [];

    // Keep the folder of the selected category or case open.
    const parentOfActiveCase = activeCaseId
        ? groups.find(group => group.cases.some(item => item.id === activeCaseId))?.key
        : null;
    const openKey = activeCategory || parentOfActiveCase;
    useEffect(() => {
        if (!openKey) return;
        setExpanded(current => (current.has(openKey) ? current : new Set(current).add(openKey)));
    }, [openKey]);

    const toggle = key => setExpanded(current => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
    });

    const openCategory = group => {
        setExpanded(current => new Set(current).add(group.key));
        navigate(`/?category=${group.key}`);
    };

    if (!showSidebar) return <Outlet />;

    return (
        <div className="with-sidebar">
            <div className="sidebar-shell">
                <aside className={`category-sidebar${collapsed ? ' is-collapsed' : ''}`} aria-label={t('Navigasi slide')}>
                    {can('slides.view') && (
                        <nav className="tree sidebar-top">
                            <Link to="/" className={`tree-item${allActive ? ' active' : ''}`} title={collapsed ? t('Semua slide') : undefined}>
                                <span className="tree-toggle-space" />
                                <i className="fas fa-images tree-icon" aria-hidden="true" />
                                <span className="tree-label">{t('Semua slide')}</span>
                                {tree && <span className="tree-count">{tree.totalSlides}</span>}
                            </Link>
                        </nav>
                    )}

                    <div className="sidebar-heading">
                        <span>{t('Kategori')}</span>
                        {can('categories.manage') && (
                            <Link to="/categories" className="sidebar-action" title={t('Kelola kategori')}>
                                <i className="fas fa-cog" aria-hidden="true" />
                            </Link>
                        )}
                    </div>

                    <nav className="tree" role="tree">
                        {!tree && [0, 1, 2].map(index => <span key={index} className="tree-item skeleton" />)}

                        {groups.map(group => {
                            const isOpen = expanded.has(group.key);
                            const hasCases = group.cases.length > 0 || group.looseSlideCount > 0;
                            return (
                                <div key={group.key} role="treeitem" aria-expanded={hasCases ? isOpen : undefined}>
                                    <div className={`tree-item${activeCategory === group.key && !looseActive ? ' active' : ''}${group.muted ? ' muted' : ''}`}>
                                        {hasCases ? (
                                            <button type="button" className="tree-toggle" aria-label={isOpen ? t('Tutup') : t('Buka')}
                                                onClick={() => toggle(group.key)}>
                                                <i className={`fas fa-chevron-right${isOpen ? ' is-open' : ''}`} aria-hidden="true" />
                                            </button>
                                        ) : <span className="tree-toggle-space" />}
                                        <button type="button" className="tree-main" onClick={() => openCategory(group)} title={group.name}>
                                            <i className={`${group.color ? 'fas' : 'far'} ${isOpen && hasCases ? 'fa-folder-open' : 'fa-folder'} tree-icon`}
                                                style={group.color ? { color: group.color } : undefined} aria-hidden="true" />
                                            <span className="tree-label">{group.name}</span>
                                            <span className="tree-count">{group.slideCount}</span>
                                        </button>
                                    </div>

                                    {hasCases && isOpen && (
                                        <div className="tree-children" role="group">
                                            {group.cases.map(item => (
                                                <Link key={item.id} to={`/cases/${item.id}`} role="treeitem"
                                                    className={`tree-item tree-leaf${activeCaseId === item.id ? ' active' : ''}`}
                                                    title={`${item.title} (${item.caseNumber})`}>
                                                    <i className="fas fa-file-medical tree-icon" aria-hidden="true" />
                                                    <span className="tree-label">
                                                        <span className="tree-case-title">{item.title}</span>
                                                        <span className="tree-case-number">{item.caseNumber}</span>
                                                    </span>
                                                    <span className="tree-count">{item.slideCount}</span>
                                                </Link>
                                            ))}
                                            {group.looseSlideCount > 0 && (
                                                <Link to={`/?category=${group.key}&case=none`} role="treeitem"
                                                    className={`tree-item tree-leaf tree-loose${activeCategory === group.key && looseActive ? ' active' : ''}`}>
                                                    <i className="far fa-images tree-icon" aria-hidden="true" />
                                                    <span className="tree-label">
                                                        <span className="tree-case-title">{t('Slide tanpa case')}</span>
                                                        <span className="tree-case-number">{t('Langsung di kategori ini')}</span>
                                                    </span>
                                                    <span className="tree-count">{group.looseSlideCount}</span>
                                                </Link>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {tree && tree.unassignedSlides > 0 && can('slides.view') && (
                            <Link to="/?case=none" className={`tree-item muted${unassignedActive ? ' active' : ''}`} title={t('Slide tanpa case dan tanpa kategori')}>
                                <span className="tree-toggle-space" />
                                <i className="far fa-images tree-icon" aria-hidden="true" />
                                <span className="tree-label">{t('Belum dikelompokkan')}</span>
                                <span className="tree-count">{tree.unassignedSlides}</span>
                            </Link>
                        )}

                        {tree && !tree.categories.length && (
                            <p className="sidebar-hint">
                                {t('Belum ada kategori.')}
                                {can('categories.manage') && <> <Link to="/categories">{t('Buat kategori')}</Link> {t('untuk mengelompokkan case.')}</>}
                            </p>
                        )}
                    </nav>

                    {can('settings.manage') && (
                        <div className="sidebar-footer">
                            <NavLink to="/settings" className="tree-item" title={collapsed ? t('Pengaturan') : undefined}>
                                <span className="tree-toggle-space" />
                                <i className="fas fa-cog tree-icon" aria-hidden="true" />
                                <span className="tree-label">{t('Pengaturan')}</span>
                            </NavLink>
                        </div>
                    )}
                </aside>
                {/* On the sidebar's right border; outside the aside so its scrolling does not clip it. */}
                <button type="button" className="sidebar-edge-toggle" onClick={toggleCollapsed}
                    aria-expanded={!collapsed} aria-label={collapsed ? t('Perluas sidebar') : t('Ciutkan sidebar')}
                    title={collapsed ? t('Perluas sidebar') : t('Ciutkan sidebar')}>
                    <i className={`fas ${collapsed ? 'fa-chevron-right' : 'fa-chevron-left'}`} aria-hidden="true" />
                </button>
            </div>
            <div className="with-sidebar-content">
                <Outlet />
            </div>
            <CompareBar />
        </div>
    );
}
