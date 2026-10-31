import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import Modal from '../components/Modal';
import { EmptyState, LoadingState, PageHeader } from '../components/States';
import { useToast } from '../components/Toast';
import { formatDate } from '../utils/format';
import { t } from '../i18n';

function UserModal({ initial, roles, onClose, onSaved }) {
    const toast = useToast();
    const { user: currentUser } = useAuth();
    const isSelf = initial?.id === currentUser.id;
    const [form, setForm] = useState({
        username: initial?.username || '',
        name: initial?.name || '',
        roleId: String(initial?.roleId || roles.find(role => !role.isSystem)?.id || roles[0]?.id || ''),
        password: '',
        isActive: initial ? initial.isActive : true,
    });
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const set = field => event => setForm({ ...form, [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value });

    const submit = async () => {
        setSaving(true);
        setError('');
        const body = { ...form, roleId: Number(form.roleId) };
        if (initial && !body.password) delete body.password;
        try {
            if (initial) await api(`/users/${initial.id}`, { method: 'PUT', body });
            else await api('/users', { method: 'POST', body });
            toast(initial ? 'User diperbarui.' : 'User dibuat.', 'success');
            onSaved();
        } catch (saveError) {
            setError(saveError.message);
            setSaving(false);
        }
    };

    const valid = form.name.trim() && form.roleId && (initial || (form.username.trim() && form.password.length >= 8));

    return (
        <Modal title={initial ? t('Ubah user {name}', { name: initial.username }) : t('User baru')} onClose={onClose} onSubmit={submit} footer={(
            <>
                <button type="button" className="btn btn-light" onClick={onClose}>{t('Batal')}</button>
                <button type="submit" className="btn btn-primary" disabled={saving || !valid}>{t('Simpan')}</button>
            </>
        )}>
            {error && <div className="alert alert-danger py-2">{error}</div>}
            {!initial && (
                <div className="mb-3">
                    <label className="form-label" htmlFor="userUsername">{t('Username')}{' '}<span className="text-danger">*</span></label>
                    <input id="userUsername" className="form-control" maxLength={64} autoFocus autoComplete="off"
                        value={form.username} onChange={set('username')} />
                    <div className="form-text">{t('Huruf, angka, titik, garis bawah, atau strip.')}</div>
                </div>
            )}
            <div className="mb-3">
                <label className="form-label" htmlFor="userName">{t('Nama lengkap')}{' '}<span className="text-danger">*</span></label>
                <input id="userName" className="form-control" maxLength={150} value={form.name} onChange={set('name')} />
            </div>
            <div className="mb-3">
                <label className="form-label" htmlFor="userRole">{t('Role')}{' '}<span className="text-danger">*</span></label>
                <select id="userRole" className="form-select" value={form.roleId} onChange={set('roleId')} disabled={isSelf}>
                    {roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
                {isSelf && <div className="form-text">{t('Role akun sendiri tidak dapat diubah.')}</div>}
            </div>
            <div className="mb-3">
                <label className="form-label" htmlFor="userPassword">
                    {initial ? 'Reset password' : <>{t('Password')}{' '}<span className="text-danger">*</span></>}
                </label>
                <input id="userPassword" type="password" className="form-control" autoComplete="new-password" maxLength={128}
                    placeholder={initial ? t('Kosongkan jika tidak diubah') : t('Minimal 8 karakter')}
                    value={form.password} onChange={set('password')} />
            </div>
            <div className="form-check form-switch">
                <input id="userActive" type="checkbox" className="form-check-input" checked={form.isActive} onChange={set('isActive')}
                    disabled={isSelf} />
                <label className="form-check-label" htmlFor="userActive">{t('Akun aktif')}</label>
            </div>
        </Modal>
    );
}

export default function UsersPage() {
    const toast = useToast();
    const { user: currentUser } = useAuth();
    const [users, setUsers] = useState(null);
    const [roles, setRoles] = useState([]);
    const [editing, setEditing] = useState(null);

    const load = useCallback(async () => {
        try {
            const [userData, roleData] = await Promise.all([api('/users'), api('/roles')]);
            setUsers(userData.users);
            setRoles(roleData.roles);
        } catch (error) {
            toast(error.message, 'error');
            setUsers([]);
        }
    }, [toast]);

    useEffect(() => {
        load();
    }, [load]);

    const remove = async user => {
        if (!window.confirm(t('Hapus user "{name}"? Case dan slide yang dibuatnya tetap ada.', { name: user.username }))) return;
        try {
            await api(`/users/${user.id}`, { method: 'DELETE' });
            toast('User dihapus.', 'success');
            load();
        } catch (error) {
            toast(error.message, 'error');
        }
    };

    return (
        <div className="page">
            <PageHeader
                title={t('User')}
                subtitle={users ? t('{n} user', { n: users.length }) : ' '}
                actions={(
                    <button type="button" className="btn btn-primary" onClick={() => setEditing({})} disabled={!roles.length}>
                        <i className="fas fa-user-plus me-1" aria-hidden="true" />{' '}{t('User baru')}
                    </button>
                )}
            />
            {!users ? <LoadingState /> : !users.length ? <EmptyState icon="fa-users" message={t('Belum ada user.')} /> : (
                <div className="panel">
                    <div className="table-responsive">
                        <table className="data-table">
                            <thead>
                                <tr><th>{t('Nama')}</th><th>{t('Username')}</th><th>{t('Role')}</th><th>{t('Status')}</th><th>{t('Login terakhir')}</th><th aria-label={t('Aksi')} /></tr>
                            </thead>
                            <tbody>
                                {users.map(user => (
                                    <tr key={user.id}>
                                        <td className="fw-semibold">
                                            {user.name}
                                            {user.id === currentUser.id && <span className="badge text-bg-light ms-2">{t('Anda')}</span>}
                                        </td>
                                        <td className="text-muted">{user.username}</td>
                                        <td>{user.roleName}</td>
                                        <td>
                                            <span className={`badge ${user.isActive ? 'text-bg-success' : 'text-bg-secondary'}`}>
                                                {user.isActive ? t('Aktif') : t('Nonaktif')}
                                            </span>
                                        </td>
                                        <td className="small text-muted text-nowrap">{user.lastLoginAt ? formatDate(user.lastLoginAt, true) : 'Belum pernah'}</td>
                                        <td className="text-end text-nowrap">
                                            <button type="button" className="btn btn-sm btn-light me-1" onClick={() => setEditing(user)}>
                                                <i className="fas fa-pen" aria-hidden="true" /><span className="visually-hidden">{t('Ubah')}</span>
                                            </button>
                                            <button type="button" className="btn btn-sm btn-light text-danger" onClick={() => remove(user)}
                                                disabled={user.id === currentUser.id}>
                                                <i className="fas fa-trash-alt" aria-hidden="true" /><span className="visually-hidden">{t('Hapus')}</span>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            {editing && (
                <UserModal initial={editing.id ? editing : null} roles={roles} onClose={() => setEditing(null)}
                    onSaved={() => { setEditing(null); load(); }} />
            )}
        </div>
    );
}
