import { supabase } from './supabase';
import type { AuthorizedHospital } from './store';

interface EmployeeLoginRpcHospital {
    sg?: unknown;
    rm?: unknown;
    dm?: unknown;
    mics?: unknown;
    hospital_name?: unknown;
    hospital_code?: unknown;
}

interface EmployeeLoginRpcResponse {
    is_valid?: unknown;
    employee_name?: unknown;
    employee_code?: unknown;
    hospitals?: unknown;
}

export interface VerifyEmployeeAccessResult {
    isValid: boolean;
    employeeName: string;
    employeeId: string;
    hospitals: AuthorizedHospital[];
}

function normalizeText(value: string): string {
    return value.trim();
}

function toText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function toHospital(item: EmployeeLoginRpcHospital): AuthorizedHospital | null {
    const hospitalCode = toText(item.hospital_code);
    if (!hospitalCode) return null;

    return {
        hospitalCode,
        hospitalName: toText(item.hospital_name),
        sg: toText(item.sg),
        rm: toText(item.rm),
        dm: toText(item.dm),
        mics: toText(item.mics),
    };
}

function dedupeHospitals(items: AuthorizedHospital[]): AuthorizedHospital[] {
    const map = new Map<string, AuthorizedHospital>();
    items.forEach((item) => {
        if (!map.has(item.hospitalCode)) {
            map.set(item.hospitalCode, item);
        }
    });
    return Array.from(map.values()).sort((a, b) => a.hospitalCode.localeCompare(b.hospitalCode));
}

export async function verifyEmployeeAccess(employeeNameInput: string, employeeIdInput: string): Promise<VerifyEmployeeAccessResult> {
    const employeeName = normalizeText(employeeNameInput);
    const employeeId = normalizeText(employeeIdInput);

    if (!employeeName || !employeeId) {
        return {
            isValid: false,
            employeeName,
            employeeId,
            hospitals: [],
        };
    }

    const { data, error } = await supabase.rpc('employee_login', {
        p_employee_name: employeeName,
        p_employee_code: employeeId,
    });

    if (error) {
        if (/Could not find the function|does not exist|schema cache/i.test(error.message)) {
            throw new Error('数据库缺少 employee_login 函数，请先执行员工鉴权迁移脚本。');
        }
        throw new Error(error.message);
    }

    const payload = (data ?? {}) as EmployeeLoginRpcResponse;
    const isValid = Boolean(payload.is_valid);

    const hospitalsRaw = Array.isArray(payload.hospitals) ? payload.hospitals : [];
    const hospitals = dedupeHospitals(
        hospitalsRaw
            .map((item) => toHospital((item ?? {}) as EmployeeLoginRpcHospital))
            .filter((item): item is AuthorizedHospital => item !== null)
    );

    return {
        isValid,
        employeeName: employeeName || toText(payload.employee_name),
        employeeId: employeeId || toText(payload.employee_code),
        hospitals,
    };
}

