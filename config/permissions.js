// Every permission the app checks. Roles are built from these keys in the Roles page;
// adding a permission here makes it selectable there and in requirePermission().
const PERMISSIONS = [
    { key: 'cases.view', group: 'Case', label: 'Melihat case' },
    { key: 'cases.create', group: 'Case', label: 'Membuat case' },
    { key: 'cases.update', group: 'Case', label: 'Mengubah case dan memindahkan slide' },
    { key: 'cases.delete', group: 'Case', label: 'Menghapus case' },
    { key: 'slides.view', group: 'Slide', label: 'Melihat slide' },
    { key: 'slides.upload', group: 'Slide', label: 'Mengunggah slide' },
    { key: 'slides.delete', group: 'Slide', label: 'Menghapus slide' },
    { key: 'annotations.edit', group: 'Slide', label: 'Membuat dan menyimpan anotasi' },
    { key: 'shares.create', group: 'Berbagi', label: 'Membuat dan mencabut link berbagi miliknya' },
    { key: 'shares.manage', group: 'Berbagi', label: 'Melihat dan mencabut semua link berbagi' },
    { key: 'categories.manage', group: 'Administrasi', label: 'Mengelola kategori' },
    { key: 'users.manage', group: 'Administrasi', label: 'Mengelola user' },
    { key: 'roles.manage', group: 'Administrasi', label: 'Mengelola role dan permission' },
    { key: 'settings.manage', group: 'Administrasi', label: 'Mengatur nama, subtitle, dan logo aplikasi' },
];

const PERMISSION_KEYS = PERMISSIONS.map(permission => permission.key);

// Roles created on first start. The administrator role is a system role: it always has
// every permission and cannot be edited or deleted, so the app can never lock itself out.
const DEFAULT_ROLES = [
    {
        name: 'Administrator',
        description: 'Akses penuh ke seluruh fitur.',
        isSystem: true,
        permissions: PERMISSION_KEYS,
    },
    {
        name: 'Patolog',
        description: 'Mengelola case, mengunggah slide, dan membuat anotasi.',
        isSystem: false,
        permissions: [
            'cases.view', 'cases.create', 'cases.update',
            'slides.view', 'slides.upload', 'annotations.edit', 'shares.create',
        ],
    },
    {
        name: 'Viewer',
        description: 'Hanya melihat case, slide, dan anotasi.',
        isSystem: false,
        permissions: ['cases.view', 'slides.view'],
    },
];

module.exports = {
    PERMISSIONS,
    PERMISSION_KEYS,
    DEFAULT_ROLES,
};
