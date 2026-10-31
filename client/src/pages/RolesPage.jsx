import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import Modal from '../components/Modal';
import { LoadingState, PageHeader } from '../components/States';
import { useToast } from '../components/Toast';
import { t } from '../i18n';

function RoleModal({ initial, permissions, onClose, onSaved }) {
    const toast = useToast();
    const [form, setForm] = useState({
        name: initial?.name || '',
        description: initial?.description || '',
        permissions: new Set(initial?.permissions || []),
    });
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const groups = useMemo(() => {
        const byGroup = new Map();
        for (const permission of permissions) {
            if (!byGroup.has(permission.group)) byGroup.set(permission.group, []);
            byGroup.get(permission.group).push(permission);
        }
        return [...byGroup.entries()];
    }, [permissions]);

    const toggle = key => {
        const next = new Set(form.permissions);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        setForm({ ...form, permissions: next });
    };

    const toggleGroup = items => {
        const allOn = items.every(item => form.permissions.has(item.key));
        const next = new Set(form.permissions);
        for (const item of items) {
            if (allOn) next.delete(item.key);
            else next.add(item.key);
        }
        setForm({ ...form, permissions: next });
    };

    const submit = async () => {
        setSaving(true);
        setError('');
        const body = { name: form.name, description: form.description, permissions: [...form.permissions] };
        try {
            if (initial) await api(`/roles/${initial.id}`, { method: 'PUT', body });
            else await api('/roles', { method: 'POST', body });
            toast(initial ? 'Role diperbarui.' : 'Role dibuat.', 'success');
            onSaved();
        } catch (saveError) {
            setError(saveError.message);
            setSaving(false);
        }
    };

    return (
        <Modal title={initial ? t('Ubah role {name}', { name: initial.name }) : t('Role baru')} onClose={onClose} onSubmit={submit} size="lg" footer={(
            <>
                <button type="button" className="btn btn-light" onClick={onClose}>{t('Batal')}</button>
                <button type="submit" className="btn btn-primary" disabled={saving || !form.name.trim()}>{t('Simpan')}</button>
            </>
        )}>
            {error && <div className="alert alert-danger py-2">{error}</div>}
            <div className="row g-3 mb-3">
                <div className="col-md-5">
                    <label className="form-label" htmlFor="roleName">{t('Nama role')}{' '}<span className="text-danger">*</span></label>
                    <input id="roleName" className="form-control" maxLength={100} autoFocus value={form.name}
                        onChange={event => setForm({ ...form, name: event.target.value })} />
                </div>
                <div className="col-md-7">
                    <label className="form-label" htmlFor="roleDescription">{t('Deskripsi')}</label>
                    <input id="roleDescription" className="form-control" maxLength={255} value={form.description}
                        onChange={event => setForm({ ...form, description: event.target.value })} />
                </div>
            </div>
            <label className="form-label">{t('Permission')}</label>
            <div className="permission-groups">
                {groups.map(([group, items]) => (
                    <fieldset key={group} className="permission-group">
                        <legend>
                            <span>{t(group)}</span>
                            <button type="button" className="btn btn-link btn-sm p-0" onClick={() => toggleGroup(items)}>
                                {items.every(item => form.permissions.has(item.key)) ? t('Hapus semua') : t('Pilih semua')}
                            </button>
                        </legend>
                        {items.map(item => (
                            <div key={item.key} className="form-check">
                                <input id={`perm-${item.key}`} type="checkbox" className="form-check-input"
                                    checked={form.permissions.has(item.key)} onChange={() => toggle(item.key)} />
                                <label className="form-check-label" htmlFor={`perm-${item.key}`}>
                                    {t(item.label)} <code className="small text-muted">{item.key}</code>
                                </label>
                            </div>
                        ))}
                    </fieldset>
                ))}
            </div>
        </Modal>
    );
}

export default function RolesPage() {
    const toast = useToast();
    const { refresh } = useAuth();
    const [roles, setRoles] = useState(null);
    const [permissions, setPermissions] = useState([]);
    const [editing, setEditing] = useState(null);

    const load = useCallback(async () => {
        try {
            const [roleData, permissionData] = await Promise.all([api('/roles'), api('/permissions')]);
            setRoles(roleData.roles);
            setPermissions(permissionData.permissions);
        } catch (error) {
            toast(error.message, 'error');
            setRoles([]);
        }
    }, [toast]);

    useEffect(() => {
        load();
    }, [load]);

    const labelOf = useMemo(() => new Map(permissions.map(permission => [permission.key, permission.label])), [permissions]);

    const remove = async role => {
        if (!window.confirm(t('Hapus role "{name}"?', { name: role.name }))) return;
        try {
            await api(`/roles/${role.id}`, { method: 'DELETE' });
            toast('Role dihapus.', 'success');
            load();
        } catch (error) {
            toast(error.message, 'error');
        }
    };

    return (
        <div className="page">
            <PageHeader
                title={t('Role & Permission')}
                subtitle={t('Atur hak akses setiap role. Perubahan langsung berlaku untuk semua user dengan role tersebut.')}
                actions={(
                    <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>
                        <i className="fas fa-plus me-1" aria-hidden="true" />{' '}{t('Role baru')}
                    </button>
                )}
            />
            {!roles ? <LoadingState /> : (
                <div className="role-grid">
                    {roles.map(role => (
                        <div key={role.id} className="panel role-card">
                            <div className="card-body">
                                <div className="d-flex align-items-start gap-2 mb-2">
                                    <div className="flex-grow-1">
                                        <h2 className="role-name">
                                            {role.name}
                                            {role.isSystem && <span className="badge text-bg-dark ms-2">{t('Sistem')}</span>}
                                        </h2>
                                        <div className="small text-muted">{role.description ? t(role.description) : t('Tanpa deskripsi')}</div>
                                    </div>
                                    {!role.isSystem && (
                                        <div className="text-nowrap">
                                            <button type="button" className="btn btn-sm btn-light me-1" onClick={() => setEditing(role)}>
                                                <i className="fas fa-pen" aria-hidden="true" /><span className="visually-hidden">{t('Ubah')}</span>
                                            </button>
                                            <button type="button" className="btn btn-sm btn-light text-danger" onClick={() => remove(role)}
                                                disabled={role.userCount > 0} title={role.userCount > 0 ? t('Masih dipakai user') : t('Hapus')}>
                                                <i className="fas fa-trash-alt" aria-hidden="true" /><span className="visually-hidden">{t('Hapus')}</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <div className="small mb-2"><i className="fas fa-users me-1 text-muted" aria-hidden="true" />{t('{n} user', { n: role.userCount })}</div>
                                <div className="permission-chips">
                                    {role.isSystem ? <span className="permission-chip is-all">{t('Semua permission')}</span>
                                        : role.permissions.length ? role.permissions.map(key => (
                                            <span key={key} className="permission-chip" title={key}>{labelOf.has(key) ? t(labelOf.get(key)) : key}</span>
                                        )) : <span className="text-muted small">{t('Tidak ada permission')}</span>}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {editing && (
                <RoleModal initial={editing.id ? editing : null} permissions={permissions} onClose={() => setEditing(null)}
                    onSaved={() => { setEditing(null); load(); refresh(); }} />
            )}
        </div>
    );
}
