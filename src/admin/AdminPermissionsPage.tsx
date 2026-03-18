import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Plus, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAppStore } from '../lib/store';

type AdminRole = 'super_admin' | 'admin' | 'viewer';

interface AdminAccountRow {
    id: string;
    employeeCode: string;
    employeeName: string;
    role: AdminRole;
    canViewDashboard: boolean;
    canManageData: boolean;
    canManageQuestions: boolean;
    canManageStrategies: boolean;
    isActive: boolean;
    updatedAt: string;
}

interface EmployeeIdentityRow {
    employeeCode: string;
    employeeName: string;
    isActive: boolean;
}

interface NewAccountForm {
    employeeCode: string;
    employeeName: string;
    role: AdminRole;
    canViewDashboard: boolean;
    canManageData: boolean;
    canManageQuestions: boolean;
    canManageStrategies: boolean;
    isActive: boolean;
}

function toText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function toBoolean(value: unknown, fallback = false): boolean {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return fallback;
}

function normalizeRole(value: unknown): AdminRole {
    if (value === 'super_admin' || value === 'admin' || value === 'viewer') return value;
    return 'admin';
}

function normalizeAccount(row: Record<string, unknown>): AdminAccountRow {
    return {
        id: toText(row.id),
        employeeCode: toText(row.employee_code),
        employeeName: toText(row.employee_name),
        role: normalizeRole(row.role),
        canViewDashboard: toBoolean(row.can_view_dashboard),
        canManageData: toBoolean(row.can_manage_data),
        canManageQuestions: toBoolean(row.can_manage_questions),
        canManageStrategies: toBoolean(row.can_manage_strategies),
        isActive: toBoolean(row.is_active, true),
        updatedAt: toText(row.updated_at),
    };
}

function withRolePreset(input: NewAccountForm | AdminAccountRow, role: AdminRole) {
    if (role === 'super_admin') {
        return {
            ...input,
            role,
            canViewDashboard: true,
            canManageData: true,
            canManageQuestions: true,
            canManageStrategies: true,
        };
    }

    if (role === 'viewer') {
        return {
            ...input,
            role,
            canViewDashboard: true,
            canManageData: false,
            canManageQuestions: false,
            canManageStrategies: false,
        };
    }

    return {
        ...input,
        role,
        canViewDashboard: true,
    };
}

const DEFAULT_NEW_FORM: NewAccountForm = {
    employeeCode: '',
    employeeName: '',
    role: 'viewer',
    canViewDashboard: true,
    canManageData: false,
    canManageQuestions: false,
    canManageStrategies: false,
    isActive: true,
};

export default function AdminPermissionsPage() {
    const adminSession = useAppStore((state) => state.adminSession);
    const [accounts, setAccounts] = useState<AdminAccountRow[]>([]);
    const [employeeIdentities, setEmployeeIdentities] = useState<EmployeeIdentityRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [savingRowId, setSavingRowId] = useState<string | null>(null);
    const [newForm, setNewForm] = useState<NewAccountForm>(DEFAULT_NEW_FORM);
    const [errorText, setErrorText] = useState('');
    const [successText, setSuccessText] = useState('');

    const canManagePermissions = adminSession?.role === 'super_admin';

    const loadData = useCallback(async () => {
        const [accountsResult, identitiesResult] = await Promise.all([
            supabase
                .from('admin_accounts')
                .select('id, employee_code, employee_name, role, can_view_dashboard, can_manage_data, can_manage_questions, can_manage_strategies, is_active, updated_at')
                .order('employee_code', { ascending: true }),
            supabase
                .from('employee_identities')
                .select('employee_code, employee_name, is_active')
                .order('employee_code', { ascending: true }),
        ]);

        if (accountsResult.error) {
            setErrorText(`读取管理员权限失败：${accountsResult.error.message}`);
            setIsLoading(false);
            return;
        }

        if (identitiesResult.error) {
            setErrorText(`读取员工库失败：${identitiesResult.error.message}`);
            setIsLoading(false);
            return;
        }

        const accountRows = (accountsResult.data ?? []).map((item) => normalizeAccount(item as Record<string, unknown>));
        const identityRows = (identitiesResult.data ?? []).map((item) => ({
            employeeCode: toText((item as Record<string, unknown>).employee_code),
            employeeName: toText((item as Record<string, unknown>).employee_name),
            isActive: toBoolean((item as Record<string, unknown>).is_active, true),
        }));

        setAccounts(accountRows);
        setEmployeeIdentities(identityRows);
        setIsLoading(false);
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void loadData();
        }, 0);
        return () => {
            window.clearTimeout(timer);
        };
    }, [loadData]);

    const activeIdentityOptions = useMemo(() => {
        return employeeIdentities.filter((item) => item.isActive);
    }, [employeeIdentities]);

    const updateRow = (id: string, patch: Partial<AdminAccountRow>) => {
        setAccounts((prev) => prev.map((row) => row.id === id ? { ...row, ...patch } : row));
    };

    const handleRoleChange = (id: string, role: AdminRole) => {
        const row = accounts.find((item) => item.id === id);
        if (!row) return;
        updateRow(id, withRolePreset(row, role));
    };

    const handleNewRoleChange = (role: AdminRole) => {
        setNewForm((prev) => withRolePreset(prev, role));
    };

    const handleSaveRow = async (row: AdminAccountRow) => {
        if (!canManagePermissions) return;
        if (!row.id) return;

        setSavingRowId(row.id);
        setErrorText('');
        setSuccessText('');

        const normalized = row.role === 'super_admin' ? withRolePreset(row, 'super_admin') : row;

        const { error } = await supabase
            .from('admin_accounts')
            .update({
                role: normalized.role,
                can_view_dashboard: normalized.canViewDashboard,
                can_manage_data: normalized.canManageData,
                can_manage_questions: normalized.canManageQuestions,
                can_manage_strategies: normalized.canManageStrategies,
                is_active: normalized.isActive,
                updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);

        if (error) {
            setErrorText(`保存失败（${row.employeeName}）：${error.message}`);
            setSavingRowId(null);
            return;
        }

        setSuccessText(`已保存：${row.employeeName} (${row.employeeCode})`);
        setSavingRowId(null);
        setIsLoading(true);
        await loadData();
    };

    const handleCreateAccount = async () => {
        if (!canManagePermissions || isCreating) return;

        const employeeCode = newForm.employeeCode.trim();
        const employeeName = newForm.employeeName.trim();

        if (!employeeCode || !employeeName) {
            setErrorText('新增管理员失败：员工姓名和员工号必填。');
            return;
        }

        setIsCreating(true);
        setErrorText('');
        setSuccessText('');

        const normalized = newForm.role === 'super_admin' ? withRolePreset(newForm, 'super_admin') : newForm;

        const { error } = await supabase
            .from('admin_accounts')
            .upsert({
                employee_code: employeeCode,
                employee_name: employeeName,
                role: normalized.role,
                can_view_dashboard: normalized.canViewDashboard,
                can_manage_data: normalized.canManageData,
                can_manage_questions: normalized.canManageQuestions,
                can_manage_strategies: normalized.canManageStrategies,
                is_active: normalized.isActive,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'employee_code' });

        if (error) {
            setErrorText(`新增/更新管理员失败：${error.message}`);
            setIsCreating(false);
            return;
        }

        setSuccessText(`已保存管理员：${employeeName} (${employeeCode})`);
        setNewForm(DEFAULT_NEW_FORM);
        setIsCreating(false);
        setIsLoading(true);
        await loadData();
    };

    if (!canManagePermissions) {
        return (
            <div className="rounded-2xl p-8 text-center text-slate-600 med-panel">
                <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-amber-500" />
                <p className="med-title-md text-slate-800">当前账号无权限访问“权限管理”页面</p>
                <p className="med-subtitle text-slate-500 mt-2">仅 `super_admin` 可管理后台用户权限。</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="p-6 rounded-2xl med-panel">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <h1 className="med-title-xl text-slate-800">后台权限管理</h1>
                        <p className="med-subtitle text-slate-600 mt-1">可视化配置：看数据、改数据、改题目、改策略。</p>
                    </div>
                    <button
                        onClick={() => {
                            setIsLoading(true);
                            setErrorText('');
                            void loadData();
                        }}
                        className="med-btn-sm med-button-secondary"
                    >
                        <RefreshCw className="w-4 h-4" />
                        刷新
                    </button>
                </div>
                {errorText && <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm px-3 py-2">{errorText}</div>}
                {successText && <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm px-3 py-2">{successText}</div>}
            </div>

            <div className="p-6 rounded-2xl med-panel">
                <h2 className="med-title-md text-slate-800 mb-4 flex items-center gap-2">
                    <Plus className="w-4 h-4" />
                    新增/更新管理员
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                        <div className="text-xs text-slate-500 mb-1">从员工库选择（可选）</div>
                        <select
                            value=""
                            onChange={(event) => {
                                const code = event.target.value;
                                const selected = activeIdentityOptions.find((item) => item.employeeCode === code);
                                if (!selected) return;
                                setNewForm((prev) => ({ ...prev, employeeCode: selected.employeeCode, employeeName: selected.employeeName }));
                                event.target.value = '';
                            }}
                            className="w-full med-input rounded-lg px-3 py-2 text-sm"
                        >
                            <option value="">选择员工并自动填充</option>
                            {activeIdentityOptions.map((item) => (
                                <option key={item.employeeCode} value={item.employeeCode}>
                                    {item.employeeName} ({item.employeeCode})
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <div className="text-xs text-slate-500 mb-1">员工姓名</div>
                        <input
                            value={newForm.employeeName}
                            onChange={(event) => setNewForm((prev) => ({ ...prev, employeeName: event.target.value }))}
                            className="w-full med-input rounded-lg px-3 py-2 text-sm"
                            placeholder="例如：张伟经理"
                        />
                    </div>
                    <div>
                        <div className="text-xs text-slate-500 mb-1">员工号</div>
                        <input
                            value={newForm.employeeCode}
                            onChange={(event) => setNewForm((prev) => ({ ...prev, employeeCode: event.target.value }))}
                            className="w-full med-input rounded-lg px-3 py-2 text-sm"
                            placeholder="例如：EMP_ZW01"
                        />
                    </div>
                    <div>
                        <div className="text-xs text-slate-500 mb-1">角色</div>
                        <select
                            value={newForm.role}
                            onChange={(event) => handleNewRoleChange(event.target.value as AdminRole)}
                            className="w-full med-input rounded-lg px-3 py-2 text-sm"
                        >
                            <option value="viewer">viewer</option>
                            <option value="admin">admin</option>
                            <option value="super_admin">super_admin</option>
                        </select>
                    </div>
                </div>

                <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                    <label className="inline-flex items-center gap-2"><input type="checkbox" checked={newForm.canViewDashboard} onChange={(e) => setNewForm((p) => ({ ...p, canViewDashboard: e.target.checked }))} />看数据</label>
                    <label className="inline-flex items-center gap-2"><input type="checkbox" checked={newForm.canManageData} onChange={(e) => setNewForm((p) => ({ ...p, canManageData: e.target.checked }))} />改数据</label>
                    <label className="inline-flex items-center gap-2"><input type="checkbox" checked={newForm.canManageQuestions} onChange={(e) => setNewForm((p) => ({ ...p, canManageQuestions: e.target.checked }))} />改题目</label>
                    <label className="inline-flex items-center gap-2"><input type="checkbox" checked={newForm.canManageStrategies} onChange={(e) => setNewForm((p) => ({ ...p, canManageStrategies: e.target.checked }))} />改策略</label>
                    <label className="inline-flex items-center gap-2"><input type="checkbox" checked={newForm.isActive} onChange={(e) => setNewForm((p) => ({ ...p, isActive: e.target.checked }))} />账号启用</label>
                </div>

                <button
                    onClick={handleCreateAccount}
                    disabled={isCreating}
                    className="mt-4 med-btn-sm med-button-primary disabled:opacity-50"
                >
                    {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                    保存管理员
                </button>
            </div>

            <div className="rounded-2xl overflow-hidden med-panel">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                    <h2 className="med-title-md text-slate-800">管理员权限列表</h2>
                    <span className="text-xs text-slate-400">{accounts.length} 条</span>
                </div>
                {isLoading ? (
                    <div className="p-10 text-center text-slate-500">
                        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                        加载中...
                    </div>
                ) : (
                    <div className="overflow-auto">
                        <table className="min-w-full text-sm">
                            <thead className="bg-slate-50 text-slate-500">
                                <tr>
                                    <th className="text-left px-4 py-3 font-semibold">员工</th>
                                    <th className="text-left px-4 py-3 font-semibold">角色</th>
                                    <th className="text-center px-3 py-3 font-semibold">看数据</th>
                                    <th className="text-center px-3 py-3 font-semibold">改数据</th>
                                    <th className="text-center px-3 py-3 font-semibold">改题目</th>
                                    <th className="text-center px-3 py-3 font-semibold">改策略</th>
                                    <th className="text-center px-3 py-3 font-semibold">启用</th>
                                    <th className="text-center px-3 py-3 font-semibold">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {accounts.map((row) => (
                                    <tr key={row.id}>
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-slate-800">{row.employeeName}</div>
                                            <div className="text-xs text-slate-400 font-mono">{row.employeeCode}</div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <select
                                                value={row.role}
                                                onChange={(event) => handleRoleChange(row.id, event.target.value as AdminRole)}
                                                className="med-input rounded-md px-2 py-1 text-sm"
                                            >
                                                <option value="viewer">viewer</option>
                                                <option value="admin">admin</option>
                                                <option value="super_admin">super_admin</option>
                                            </select>
                                        </td>
                                        <td className="text-center px-3 py-3">
                                            <input type="checkbox" checked={row.canViewDashboard} onChange={(e) => updateRow(row.id, { canViewDashboard: e.target.checked })} />
                                        </td>
                                        <td className="text-center px-3 py-3">
                                            <input type="checkbox" checked={row.canManageData} onChange={(e) => updateRow(row.id, { canManageData: e.target.checked })} />
                                        </td>
                                        <td className="text-center px-3 py-3">
                                            <input type="checkbox" checked={row.canManageQuestions} onChange={(e) => updateRow(row.id, { canManageQuestions: e.target.checked })} />
                                        </td>
                                        <td className="text-center px-3 py-3">
                                            <input type="checkbox" checked={row.canManageStrategies} onChange={(e) => updateRow(row.id, { canManageStrategies: e.target.checked })} />
                                        </td>
                                        <td className="text-center px-3 py-3">
                                            <input type="checkbox" checked={row.isActive} onChange={(e) => updateRow(row.id, { isActive: e.target.checked })} />
                                        </td>
                                        <td className="text-center px-3 py-3">
                                            <button
                                                onClick={() => void handleSaveRow(row)}
                                                disabled={savingRowId === row.id}
                                                className="med-btn-sm med-button-primary text-xs disabled:opacity-50"
                                            >
                                                {savingRowId === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                                保存
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {accounts.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="text-center p-8 text-slate-400">
                                            暂无管理员记录
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
