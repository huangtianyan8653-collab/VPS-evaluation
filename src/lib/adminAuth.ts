import { supabase } from './supabase';
import type { AdminPermissions } from './store';

interface AdminLoginPayload {
    is_valid?: unknown;
    employee_name?: unknown;
    employee_code?: unknown;
    role?: unknown;
    permissions?: unknown;
}

function toText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function toBoolean(value: unknown, fallback = false): boolean {
    if (value === true) return true;
    if (value === false) return false;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fallback;
}

function normalizePermissions(raw: unknown): AdminPermissions {
    const source = (typeof raw === 'object' && raw !== null) ? raw as Record<string, unknown> : {};
    return {
        dashboard: toBoolean(source.dashboard, false),
        dataManage: toBoolean(source.manage_data, false),
        questions: toBoolean(source.questions, false),
        strategies: toBoolean(source.strategies, false),
    };
}

export interface VerifyAdminAccessResult {
    isValid: boolean;
    employeeName: string;
    employeeId: string;
    role: string;
    permissions: AdminPermissions;
}

export async function verifyAdminAccess(employeeNameInput: string, employeeIdInput: string): Promise<VerifyAdminAccessResult> {
    const employeeName = employeeNameInput.trim();
    const employeeId = employeeIdInput.trim();

    if (!employeeName || !employeeId) {
        return {
            isValid: false,
            employeeName,
            employeeId,
            role: '',
            permissions: { dashboard: false, dataManage: false, questions: false, strategies: false },
        };
    }

    const { data, error } = await supabase.rpc('admin_login', {
        p_employee_name: employeeName,
        p_employee_code: employeeId,
    });

    if (error) {
        if (/Could not find the function|does not exist|schema cache/i.test(error.message)) {
            throw new Error('数据库缺少 admin_login 函数，请先执行管理员权限迁移脚本。');
        }
        throw new Error(error.message);
    }

    const payload = (data ?? {}) as AdminLoginPayload;
    const permissions = normalizePermissions(payload.permissions);

    return {
        isValid: Boolean(payload.is_valid),
        employeeName: toText(payload.employee_name) || employeeName,
        employeeId: toText(payload.employee_code) || employeeId,
        role: toText(payload.role) || 'admin',
        permissions,
    };
}
