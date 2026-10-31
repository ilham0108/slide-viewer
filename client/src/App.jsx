import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { AuthProvider } from './auth/AuthContext';
import { ToastProvider } from './components/Toast';
import { BrandingProvider } from './components/Branding';
import { ThemeProvider } from './components/Theme';
import { LanguageProvider } from './i18n';
import { SlideSelectionProvider } from './components/CompareBar';
import AppLayout from './components/AppLayout';
import CategoryLayout from './components/CategoryLayout';
import { HomeRedirect, RequireAuth, RequirePermission } from './components/Guards';
import { EmptyState } from './components/States';
import LoginPage from './pages/LoginPage';
import CasesPage from './pages/CasesPage';
import CaseDetailPage from './pages/CaseDetailPage';
import LibraryPage from './pages/LibraryPage';
import ViewerPage from './pages/ViewerPage';
import ComparePage from './pages/ComparePage';
import CategoriesPage from './pages/CategoriesPage';
import UsersPage from './pages/UsersPage';
import RolesPage from './pages/RolesPage';
import AccountPage from './pages/AccountPage';
import SharesPage from './pages/SharesPage';
import UploadsPage from './pages/UploadsPage';
import SettingsPage from './pages/SettingsPage';
import PublicSharePage from './pages/PublicSharePage';

function guarded(permissions, element) {
    return <RequirePermission permissions={permissions}>{element}</RequirePermission>;
}

/** The start page lists every available slide; users who cannot view slides are sent on. */
function HomePage() {
    const { can } = useAuth();
    return can('slides.view') ? <LibraryPage /> : <HomeRedirect />;
}

// Old /library links keep working (including their ?case= filter).
function LibraryRedirect() {
    const location = useLocation();
    return <Navigate to={`/${location.search}`} replace />;
}

// Client routes must not start with /slides or /api: Express serves tiles and the API there.
const router = createBrowserRouter([
    { path: '/login', element: <LoginPage /> },
    // Public share links: no login.
    { path: '/s/:token/*', element: <PublicSharePage /> },
    {
        element: <RequireAuth><AppLayout /></RequireAuth>,
        children: [
            {
                // Pages with the category sidebar. Each page checks its own permission, so
                // e.g. a user who may only manage users still reaches the users page.
                element: <CategoryLayout />,
                children: [
                    { index: true, element: <HomePage /> },
                    { path: 'cases', element: guarded(['cases.view'], <CasesPage />) },
                    { path: 'cases/:caseId', element: guarded(['cases.view'], <CaseDetailPage />) },
                    { path: 'settings', element: guarded(['settings.manage'], <SettingsPage />) },
                    { path: 'uploads', element: guarded(['slides.upload', 'slides.delete'], <UploadsPage />) },
                    { path: 'shares', element: guarded(['shares.create', 'shares.manage'], <SharesPage />) },
                    { path: 'categories', element: guarded(['categories.manage'], <CategoriesPage />) },
                    { path: 'users', element: guarded(['users.manage'], <UsersPage />) },
                    { path: 'roles', element: guarded(['roles.manage'], <RolesPage />) },
                ],
            },
            { path: 'library', element: <LibraryRedirect /> },
            { path: 'viewer/:slideId', element: guarded(['slides.view'], <ViewerPage />) },
            { path: 'compare', element: guarded(['slides.view'], <ComparePage />) },
            { path: 'account', element: <AccountPage /> },
            { path: '*', element: <div className="page"><EmptyState icon="fa-map-signs" message="Halaman tidak ditemukan." /></div> },
        ],
    },
]);

export default function App() {
    return (
        <LanguageProvider>
            <ThemeProvider>
                <AuthProvider>
                    <BrandingProvider>
                        <ToastProvider>
                            <SlideSelectionProvider>
                                <RouterProvider router={router} />
                            </SlideSelectionProvider>
                        </ToastProvider>
                    </BrandingProvider>
                </AuthProvider>
            </ThemeProvider>
        </LanguageProvider>
    );
}
