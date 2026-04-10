import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, Loader2, RefreshCw, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import { resolvedSupabaseUrl, supabase } from '../lib/supabase';
import { useAppStore } from '../lib/store';

interface DataSummary {
    identityTotal: number;
    identityActive: number;
    permissionTotal: number;
    permissionActive: number;
}

interface LoginImportRow {
    employee_code: string;
    employee_name: string;
    is_active: boolean;
    updated_at: string;
}

interface ArchitectureImportRow {
    sg: string;
    rm: string;
    dm: string;
    mics: string;
    hospital_name: string;
    hospital_code: string;
    province: string;
    is_active: boolean;
}

interface LoginPreviewRow {
    rowNumber: number;
    employeeName: string;
    employeeCode: string;
    isActive: boolean;
}

interface ArchitecturePreviewRow {
    rowNumber: number;
    sg: string;
    rm: string;
    dm: string;
    mics: string;
    hospitalName: string;
    hospitalCode: string;
    province: string;
    isActive: boolean;
}

interface ParsedLoginFile {
    fileName: string;
    sheetName: string;
    sourceRows: number;
    parsedRows: number;
    skippedEmptyRows: number;
    rows: LoginImportRow[];
    previewRows: LoginPreviewRow[];
    warnings: string[];
}

interface ParsedArchitectureFile {
    fileName: string;
    sheetName: string;
    sourceRows: number;
    parsedRows: number;
    skippedEmptyRows: number;
    rows: ArchitectureImportRow[];
    previewRows: ArchitecturePreviewRow[];
    warnings: string[];
}

const PREVIEW_LIMIT = 12;
const CHUNK_SIZE = 500;
const SUPABASE_URL = resolvedSupabaseUrl;

function toText(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
    return '';
}

function normalizeHeader(value: string): string {
    const normalized = value.toLowerCase().replace(/[\s_（）()【】:：-]/g, '');
    return normalized.replaceAll('[', '').replaceAll(']', '');
}

function getHeaderMap(headers: string[]): Map<string, string> {
    const map = new Map<string, string>();
    headers.forEach((header) => {
        map.set(normalizeHeader(header), header);
    });
    return map;
}

function pickHeader(headerMap: Map<string, string>, aliases: string[]): string | null {
    for (const alias of aliases) {
        const found = headerMap.get(normalizeHeader(alias));
        if (found) return found;
    }
    return null;
}

function parseActive(value: unknown): boolean {
    if (value === true || value === false) return value;
    const text = toText(value).toLowerCase();
    if (!text) return true;

    if (['1', 'true', 'yes', 'y', '是', '启用', 'active', '有效'].includes(text)) return true;
    if (['0', 'false', 'no', 'n', '否', '停用', 'inactive', '无效'].includes(text)) return false;
    return true;
}

function readCell(row: Record<string, unknown>, key: string | null): string {
    if (!key) return '';
    return toText(row[key]);
}

function toErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error || '未知错误';

    if (error && typeof error === 'object') {
        const payload = error as {
            message?: unknown;
            details?: unknown;
            hint?: unknown;
            code?: unknown;
            error_description?: unknown;
        };

        const toSafeText = (value: unknown): string => {
            if (typeof value === 'string') return value.trim();
            if (typeof value === 'number' || typeof value === 'boolean') return String(value);
            return '';
        };

        const message = toSafeText(payload.message) || toSafeText(payload.error_description);
        const details = toSafeText(payload.details);
        const hint = toSafeText(payload.hint);
        const code = toSafeText(payload.code);

        const chunks: string[] = [];
        if (message) chunks.push(message);
        if (details) chunks.push(`details: ${details}`);
        if (hint) chunks.push(`hint: ${hint}`);
        if (code) chunks.push(`code: ${code}`);
        if (chunks.length > 0) return chunks.join(' | ');

        try {
            return JSON.stringify(error);
        } catch {
            return '未知错误';
        }
    }

    return '未知错误';
}

function isLikelyFetchNetworkError(message: string): boolean {
    return /failed to fetch|fetch failed|networkerror|load failed|ssl_error|dns|resolve host/i.test(message.toLowerCase());
}

function buildSupabaseNetworkHint(): string {
    const restEndpoint = SUPABASE_URL
        ? `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/`
        : '(未配置 VITE_SUPABASE_URL / VITE_SUPABASE_PROJECT_URL)';
    return `无法连接 Supabase 云端（网络/代理问题）。请先确认可打开 ${restEndpoint}（正常会返回 “No API key found in request”），再重试导入。`;
}

function splitChunks<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

async function readFirstSheetRows(file: File): Promise<{ sheetName: string; rows: Record<string, unknown>[] }> {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
        throw new Error('Excel 中没有可读取的工作表。');
    }

    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
    if (!rows.length) {
        throw new Error('Excel 没有可导入的数据行。');
    }
    return { sheetName, rows };
}

async function parseLoginFile(file: File): Promise<ParsedLoginFile> {
    const { sheetName, rows } = await readFirstSheetRows(file);
    const headerMap = getHeaderMap(Object.keys(rows[0] ?? {}));

    const employeeNameKey = pickHeader(headerMap, ['员工姓名', '姓名', 'employee_name', 'employeename']);
    const employeeCodeKey = pickHeader(headerMap, ['员工id', '员工ID', '员工号', '员工编码', 'employee_id', 'employee_code', 'employeecode', '工号']);
    const isActiveKey = pickHeader(headerMap, ['is_active', 'isactive', '启用', '是否启用', '状态']);

    const missingHeaders: string[] = [];
    if (!employeeNameKey) missingHeaders.push('员工姓名');
    if (!employeeCodeKey) missingHeaders.push('员工ID');
    if (missingHeaders.length > 0) {
        throw new Error(`登录信息表缺少必填列：${missingHeaders.join('、')}。`);
    }

    const warnings: string[] = [];
    const rowErrors: string[] = [];
    const dedupedRows = new Map<string, LoginImportRow>();
    const previewRows: LoginPreviewRow[] = [];
    let skippedEmptyRows = 0;

    rows.forEach((row, index) => {
        const rowNumber = index + 2;
        const employeeName = readCell(row, employeeNameKey);
        const employeeCode = readCell(row, employeeCodeKey);
        const isActive = parseActive(isActiveKey ? row[isActiveKey] : true);

        if (!employeeName && !employeeCode) {
            skippedEmptyRows += 1;
            return;
        }

        if (!employeeName || !employeeCode) {
            rowErrors.push(`第 ${rowNumber} 行员工姓名和员工ID必须同时填写。`);
            return;
        }

        const key = employeeCode.toLowerCase();
        const payload: LoginImportRow = {
            employee_code: employeeCode,
            employee_name: employeeName,
            is_active: isActive,
            updated_at: new Date().toISOString(),
        };

        const existing = dedupedRows.get(key);
        if (existing && existing.employee_name !== employeeName) {
            warnings.push(`员工ID ${employeeCode} 存在多个姓名，已采用最后一条（${employeeName}）。`);
        }
        dedupedRows.set(key, payload);

        if (previewRows.length < PREVIEW_LIMIT) {
            previewRows.push({
                rowNumber,
                employeeName,
                employeeCode,
                isActive,
            });
        }
    });

    if (rowErrors.length > 0) {
        const firstErrors = rowErrors.slice(0, 8).join('；');
        throw new Error(`登录信息表校验失败：${firstErrors}${rowErrors.length > 8 ? '；...' : ''}`);
    }

    if (dedupedRows.size === 0) {
        throw new Error('登录信息表没有有效数据行。');
    }

    return {
        fileName: file.name,
        sheetName,
        sourceRows: rows.length,
        parsedRows: dedupedRows.size,
        skippedEmptyRows,
        rows: Array.from(dedupedRows.values()),
        previewRows,
        warnings,
    };
}

async function parseArchitectureFile(file: File): Promise<ParsedArchitectureFile> {
    const { sheetName, rows } = await readFirstSheetRows(file);
    const headerMap = getHeaderMap(Object.keys(rows[0] ?? {}));

    const keys = {
        sg: pickHeader(headerMap, ['sg', 'SG']),
        rm: pickHeader(headerMap, ['rm', 'RM']),
        dm: pickHeader(headerMap, ['dm', 'DM']),
        mics: pickHeader(headerMap, ['mics', 'MICS']),
        hospitalName: pickHeader(headerMap, ['医院名称', '医院名', 'hospital_name', 'hospitalname']),
        hospitalCode: pickHeader(headerMap, ['医院编码', '医院编号', '医院代码', 'hospital_code', 'hospitalcode']),
        province: pickHeader(headerMap, ['省份', '省', 'province']),
        isActive: pickHeader(headerMap, ['is_active', 'isactive', '启用', '是否启用', '状态']),
    };

    const missingHeaders: string[] = [];
    if (!keys.hospitalName) missingHeaders.push('医院名称');
    if (!keys.hospitalCode) missingHeaders.push('医院编码');
    if (missingHeaders.length > 0) {
        throw new Error(`架构表缺少必填列：${missingHeaders.join('、')}。`);
    }

    const rowErrors: string[] = [];
    const dedupedRows = new Map<string, ArchitectureImportRow>();
    const previewRows: ArchitecturePreviewRow[] = [];
    let skippedEmptyRows = 0;

    rows.forEach((row, index) => {
        const rowNumber = index + 2;
        const sg = readCell(row, keys.sg);
        const rm = readCell(row, keys.rm);
        const dm = readCell(row, keys.dm);
        const mics = readCell(row, keys.mics);
        const hospitalName = readCell(row, keys.hospitalName);
        const hospitalCode = readCell(row, keys.hospitalCode);
        const province = readCell(row, keys.province);
        const isActive = parseActive(keys.isActive ? row[keys.isActive] : true);

        if (![sg, rm, dm, mics, hospitalName, hospitalCode, province].some(Boolean)) {
            skippedEmptyRows += 1;
            return;
        }

        const missingCells: string[] = [];
        if (!hospitalName) missingCells.push('医院名称');
        if (!hospitalCode) missingCells.push('医院编码');
        if (missingCells.length > 0) {
            rowErrors.push(`第 ${rowNumber} 行缺少：${missingCells.join('、')}`);
            return;
        }

        const key = [sg, rm, dm, mics, hospitalName, hospitalCode, province].join('||').toLowerCase();
        dedupedRows.set(key, {
            sg,
            rm,
            dm,
            mics,
            hospital_name: hospitalName,
            hospital_code: hospitalCode,
            province,
            is_active: isActive,
        });

        if (previewRows.length < PREVIEW_LIMIT) {
            previewRows.push({
                rowNumber,
                sg,
                rm,
                dm,
                mics,
                hospitalName,
                hospitalCode,
                province,
                isActive,
            });
        }
    });

    if (rowErrors.length > 0) {
        const firstErrors = rowErrors.slice(0, 8).join('；');
        throw new Error(`架构表校验失败：${firstErrors}${rowErrors.length > 8 ? '；...' : ''}`);
    }

    if (dedupedRows.size === 0) {
        throw new Error('架构表没有有效数据行。');
    }

    return {
        fileName: file.name,
        sheetName,
        sourceRows: rows.length,
        parsedRows: dedupedRows.size,
        skippedEmptyRows,
        rows: Array.from(dedupedRows.values()),
        previewRows,
        warnings: [],
    };
}

export default function EmployeeAuthConfigPage() {
    const adminSession = useAppStore((state) => state.adminSession);
    const canManageEmployeeAuth = Boolean(adminSession?.role === 'super_admin' || adminSession?.permissions.employeeAuth);

    const [summary, setSummary] = useState<DataSummary>({
        identityTotal: 0,
        identityActive: 0,
        permissionTotal: 0,
        permissionActive: 0,
    });

    const [isLoadingSummary, setIsLoadingSummary] = useState(true);
    const [errorText, setErrorText] = useState('');
    const [successText, setSuccessText] = useState('');

    const [loginFile, setLoginFile] = useState<File | null>(null);
    const [parsedLogin, setParsedLogin] = useState<ParsedLoginFile | null>(null);
    const [isParsingLogin, setIsParsingLogin] = useState(false);
    const [isImportingLogin, setIsImportingLogin] = useState(false);
    const [replaceIdentities, setReplaceIdentities] = useState(true);

    const [architectureFile, setArchitectureFile] = useState<File | null>(null);
    const [parsedArchitecture, setParsedArchitecture] = useState<ParsedArchitectureFile | null>(null);
    const [isParsingArchitecture, setIsParsingArchitecture] = useState(false);
    const [isImportingArchitecture, setIsImportingArchitecture] = useState(false);
    const [replacePermissions, setReplacePermissions] = useState(true);

    const loginPreviewScrollRef = useRef<HTMLDivElement | null>(null);
    const architecturePreviewScrollRef = useRef<HTMLDivElement | null>(null);

    const loadSummary = useCallback(async () => {
        setIsLoadingSummary(true);
        setErrorText('');

        const [identityTotal, identityActive, permissionTotal, permissionActive] = await Promise.all([
            supabase.from('employee_identities').select('id', { head: true, count: 'exact' }),
            supabase.from('employee_identities').select('id', { head: true, count: 'exact' }).eq('is_active', true),
            supabase.from('employee_permissions').select('id', { head: true, count: 'exact' }),
            supabase.from('employee_permissions').select('id', { head: true, count: 'exact' }).eq('is_active', true),
        ]);

        if (identityTotal.error || identityActive.error || permissionTotal.error || permissionActive.error) {
            const firstError = identityTotal.error || identityActive.error || permissionTotal.error || permissionActive.error;
            setErrorText(`读取当前数据规模失败：${firstError?.message ?? '未知错误'}`);
            setIsLoadingSummary(false);
            return;
        }

        setSummary({
            identityTotal: identityTotal.count ?? 0,
            identityActive: identityActive.count ?? 0,
            permissionTotal: permissionTotal.count ?? 0,
            permissionActive: permissionActive.count ?? 0,
        });
        setIsLoadingSummary(false);
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void loadSummary();
        }, 0);
        return () => {
            window.clearTimeout(timer);
        };
    }, [loadSummary]);

    useEffect(() => {
        if (!successText) return;
        const timer = window.setTimeout(() => setSuccessText(''), 3000);
        return () => window.clearTimeout(timer);
    }, [successText]);

    const loginStatusText = useMemo(() => {
        if (!parsedLogin) return '未解析登录信息表';
        return `已解析：${parsedLogin.fileName} / ${parsedLogin.parsedRows} 条员工`;
    }, [parsedLogin]);

    const architectureStatusText = useMemo(() => {
        if (!parsedArchitecture) return '未解析架构表';
        return `已解析：${parsedArchitecture.fileName} / ${parsedArchitecture.parsedRows} 条架构权限`;
    }, [parsedArchitecture]);

    const scrollPreview = (target: 'login' | 'architecture', direction: 'left' | 'right') => {
        const ref = target === 'login' ? loginPreviewScrollRef : architecturePreviewScrollRef;
        const el = ref.current;
        if (!el) return;
        const offset = direction === 'left' ? -360 : 360;
        el.scrollBy({ left: offset, behavior: 'smooth' });
    };

    const handleParseLogin = async () => {
        if (!loginFile || isParsingLogin) {
            setErrorText('请先选择“登录信息表”文件。');
            return;
        }

        setIsParsingLogin(true);
        setErrorText('');
        setSuccessText('');
        setParsedLogin(null);

        try {
            const result = await parseLoginFile(loginFile);
            setParsedLogin(result);
            setSuccessText(`登录信息表解析成功：${result.parsedRows} 条员工。`);
        } catch (error) {
            console.error('[EmployeeAuthConfigPage] parse login file failed', error);
            setErrorText(`登录信息表解析失败：${toErrorMessage(error)}`);
        } finally {
            setIsParsingLogin(false);
        }
    };

    const handleParseArchitecture = async () => {
        if (!architectureFile || isParsingArchitecture) {
            setErrorText('请先选择“架构表”文件。');
            return;
        }

        setIsParsingArchitecture(true);
        setErrorText('');
        setSuccessText('');
        setParsedArchitecture(null);

        try {
            const result = await parseArchitectureFile(architectureFile);
            setParsedArchitecture(result);
            setSuccessText(`架构表解析成功：${result.parsedRows} 条权限。`);
        } catch (error) {
            console.error('[EmployeeAuthConfigPage] parse architecture file failed', error);
            setErrorText(`架构表解析失败：${toErrorMessage(error)}`);
        } finally {
            setIsParsingArchitecture(false);
        }
    };

    const handleImportLogin = async () => {
        if (!parsedLogin || isImportingLogin) {
            setErrorText('请先解析“登录信息表”，再执行导入。');
            return;
        }

        setIsImportingLogin(true);
        setErrorText('');
        setSuccessText('');

        try {
            if (replaceIdentities) {
                const { error: deleteError } = await supabase
                    .from('employee_identities')
                    .delete()
                    .not('id', 'is', null);
                if (deleteError) throw deleteError;

                const insertChunks = splitChunks(parsedLogin.rows, CHUNK_SIZE);
                for (const chunk of insertChunks) {
                    const { error } = await supabase.from('employee_identities').insert(chunk);
                    if (error) throw error;
                }
            } else {
                const upsertChunks = splitChunks(parsedLogin.rows, CHUNK_SIZE);
                for (const chunk of upsertChunks) {
                    const { error } = await supabase
                        .from('employee_identities')
                        .upsert(chunk, { onConflict: 'employee_code' });
                    if (error) throw error;
                }
            }

            setSuccessText(`登录信息表导入完成：${parsedLogin.rows.length} 条员工。`);
            await loadSummary();
        } catch (error) {
            console.error('[EmployeeAuthConfigPage] import login file failed', error);
            const message = toErrorMessage(error);
            if (isLikelyFetchNetworkError(message)) {
                setErrorText(`登录信息表导入失败：${buildSupabaseNetworkHint()}`);
            } else {
                setErrorText(`登录信息表导入失败：${message}`);
            }
        } finally {
            setIsImportingLogin(false);
        }
    };

    const handleImportArchitecture = async () => {
        if (!parsedArchitecture || isImportingArchitecture) {
            setErrorText('请先解析“架构表”，再执行导入。');
            return;
        }

        setIsImportingArchitecture(true);
        setErrorText('');
        setSuccessText('');

        try {
            if (replacePermissions) {
                const { error: deleteError } = await supabase
                    .from('employee_permissions')
                    .delete()
                    .not('id', 'is', null);
                if (deleteError) throw deleteError;

                const insertChunks = splitChunks(parsedArchitecture.rows, CHUNK_SIZE);
                for (const chunk of insertChunks) {
                    const { error } = await supabase.from('employee_permissions').insert(chunk);
                    if (error) throw error;
                }
            } else {
                const upsertChunks = splitChunks(parsedArchitecture.rows, CHUNK_SIZE);
                for (const chunk of upsertChunks) {
                    const { error } = await supabase
                        .from('employee_permissions')
                        .upsert(chunk, { onConflict: 'sg,rm,dm,mics,hospital_name,hospital_code' });
                    if (error) throw error;
                }
            }

            setSuccessText(`架构表导入完成：${parsedArchitecture.rows.length} 条权限。`);
            await loadSummary();
        } catch (error) {
            console.error('[EmployeeAuthConfigPage] import architecture file failed', error);
            const message = toErrorMessage(error);
            if (/province.*does not exist|column .*province/i.test(message)) {
                setErrorText('架构表导入失败：数据库缺少 province 字段，请先执行迁移脚本 20260323_employee_permissions_province.sql。');
            } else if (isLikelyFetchNetworkError(message)) {
                setErrorText(`架构表导入失败：${buildSupabaseNetworkHint()}`);
            } else {
                setErrorText(`架构表导入失败：${message}`);
            }
        } finally {
            setIsImportingArchitecture(false);
        }
    };

    if (!canManageEmployeeAuth) {
        return (
            <div className="rounded-2xl p-8 text-center text-slate-600 med-panel">
                <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-amber-500" />
                <p className="med-title-md text-slate-800">当前账号无权限访问“员工登录库”页面</p>
                <p className="med-subtitle text-slate-500 mt-2">请联系超级管理员分配“员工库管理”权限。</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="p-6 rounded-2xl med-panel">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <h1 className="med-title-xl text-slate-800">员工登录库管理（双文件上传）</h1>
                        <p className="med-subtitle text-slate-600 mt-1">分别上传“登录信息表”和“架构表”，解析预览后批量更新。</p>
                    </div>
                    <button
                        onClick={() => {
                            setErrorText('');
                            void loadSummary();
                        }}
                        className="med-btn-sm med-button-secondary"
                    >
                        <RefreshCw className="w-4 h-4" />
                        刷新统计
                    </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 text-sm">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">员工总数：<span className="font-semibold text-slate-800">{isLoadingSummary ? '...' : summary.identityTotal}</span></div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">员工启用：<span className="font-semibold text-slate-800">{isLoadingSummary ? '...' : summary.identityActive}</span></div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">权限总数：<span className="font-semibold text-slate-800">{isLoadingSummary ? '...' : summary.permissionTotal}</span></div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">权限启用：<span className="font-semibold text-slate-800">{isLoadingSummary ? '...' : summary.permissionActive}</span></div>
                </div>

                {errorText && <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm px-3 py-2">{errorText}</div>}
                {successText && <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm px-3 py-2">{successText}</div>}
            </div>

            <div className="p-6 rounded-2xl med-panel space-y-4">
                <h2 className="med-title-md text-slate-800">1) 登录信息表（员工姓名、员工ID）</h2>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 leading-6">
                    必填列：`员工姓名`、`员工ID`；可选列：`是否启用`。<br />
                    支持中英文表头别名：`employee_name`、`employee_id`。
                </div>

                <div className="rounded-xl border border-slate-200 p-4 space-y-3 bg-white">
                    <div className="flex flex-col md:flex-row md:items-center gap-3">
                        <label className="med-btn-sm med-button-secondary cursor-pointer inline-flex items-center gap-2">
                            <FileUp className="w-4 h-4" />
                            选择登录信息表
                            <input
                                type="file"
                                accept=".xlsx,.xls,.csv"
                                className="hidden"
                                onChange={(event) => {
                                    const file = event.target.files?.[0] ?? null;
                                    setLoginFile(file);
                                    setParsedLogin(null);
                                    setErrorText('');
                                    setSuccessText('');
                                }}
                            />
                        </label>
                        <div className="text-sm text-slate-600 break-all">{loginFile ? loginFile.name : '未选择文件'}</div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={() => void handleParseLogin()}
                            disabled={!loginFile || isParsingLogin || isImportingLogin}
                            className="med-btn-sm med-button-secondary disabled:opacity-50"
                        >
                            {isParsingLogin ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                            解析预览
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleImportLogin()}
                            disabled={!parsedLogin || isParsingLogin || isImportingLogin}
                            className="med-btn-sm med-button-primary disabled:opacity-50"
                        >
                            {isImportingLogin ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                            导入登录信息
                        </button>
                        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                            <input type="checkbox" checked={replaceIdentities} onChange={(event) => setReplaceIdentities(event.target.checked)} />
                            覆盖旧登录库（推荐）
                        </label>
                        <span className="text-xs text-slate-500">{loginStatusText}</span>
                    </div>
                </div>

                {parsedLogin && (
                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-sm text-slate-700 flex flex-wrap items-center gap-x-5 gap-y-1">
                            <span>文件：{parsedLogin.fileName}</span>
                            <span>Sheet：{parsedLogin.sheetName}</span>
                            <span>源行数：{parsedLogin.sourceRows}</span>
                            <span>有效员工：{parsedLogin.parsedRows}</span>
                            <span>空行跳过：{parsedLogin.skippedEmptyRows}</span>
                        </div>
                        {parsedLogin.warnings.length > 0 && (
                            <div className="px-4 py-3 text-xs text-amber-700 bg-amber-50 border-b border-amber-100 space-y-1">
                                {parsedLogin.warnings.slice(0, 6).map((item, index) => (
                                    <div key={`${item}-${index}`}>- {item}</div>
                                ))}
                                {parsedLogin.warnings.length > 6 && <div>- 还有 {parsedLogin.warnings.length - 6} 条提示...</div>}
                            </div>
                        )}
                        <div className="px-4 py-2 border-b border-slate-100 bg-white flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => scrollPreview('login', 'left')}
                                className="med-btn-sm med-button-secondary"
                            >
                                向左滑
                            </button>
                            <button
                                type="button"
                                onClick={() => scrollPreview('login', 'right')}
                                className="med-btn-sm med-button-secondary"
                            >
                                向右滑
                            </button>
                        </div>
                        <div ref={loginPreviewScrollRef} className="overflow-auto max-h-[440px]">
                            <table className="min-w-[680px] w-full text-sm">
                                <thead className="bg-slate-50 text-slate-600">
                                    <tr>
                                        <th className="text-left px-3 py-2">行号</th>
                                        <th className="text-left px-3 py-2">员工姓名</th>
                                        <th className="text-left px-3 py-2">员工ID</th>
                                        <th className="text-left px-3 py-2">启用</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {parsedLogin.previewRows.map((row) => (
                                        <tr key={`${row.rowNumber}-${row.employeeCode}`}>
                                            <td className="px-3 py-2">{row.rowNumber}</td>
                                            <td className="px-3 py-2">{row.employeeName}</td>
                                            <td className="px-3 py-2 font-mono">{row.employeeCode}</td>
                                            <td className="px-3 py-2">{row.isActive ? 'true' : 'false'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            <div className="p-6 rounded-2xl med-panel space-y-4">
                <h2 className="med-title-md text-slate-800">2) 架构表（SG、RM、DM、MICS、医院名称、医院编码、省份）</h2>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 leading-6">
                    必填列：`医院名称`、`医院编码`。<br />
                    可空列：`SG`、`RM`、`DM`、`MICS`、`省份`；可选列：`是否启用`。<br />
                    如提示缺少 `province` 字段，请先执行迁移脚本：`20260323_employee_permissions_province.sql`。
                </div>

                <div className="rounded-xl border border-slate-200 p-4 space-y-3 bg-white">
                    <div className="flex flex-col md:flex-row md:items-center gap-3">
                        <label className="med-btn-sm med-button-secondary cursor-pointer inline-flex items-center gap-2">
                            <FileUp className="w-4 h-4" />
                            选择架构表
                            <input
                                type="file"
                                accept=".xlsx,.xls,.csv"
                                className="hidden"
                                onChange={(event) => {
                                    const file = event.target.files?.[0] ?? null;
                                    setArchitectureFile(file);
                                    setParsedArchitecture(null);
                                    setErrorText('');
                                    setSuccessText('');
                                }}
                            />
                        </label>
                        <div className="text-sm text-slate-600 break-all">{architectureFile ? architectureFile.name : '未选择文件'}</div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={() => void handleParseArchitecture()}
                            disabled={!architectureFile || isParsingArchitecture || isImportingArchitecture}
                            className="med-btn-sm med-button-secondary disabled:opacity-50"
                        >
                            {isParsingArchitecture ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                            解析预览
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleImportArchitecture()}
                            disabled={!parsedArchitecture || isParsingArchitecture || isImportingArchitecture}
                            className="med-btn-sm med-button-primary disabled:opacity-50"
                        >
                            {isImportingArchitecture ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                            导入架构权限
                        </button>
                        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                            <input type="checkbox" checked={replacePermissions} onChange={(event) => setReplacePermissions(event.target.checked)} />
                            覆盖旧权限库（推荐）
                        </label>
                        <span className="text-xs text-slate-500">{architectureStatusText}</span>
                    </div>
                </div>

                {parsedArchitecture && (
                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-sm text-slate-700 flex flex-wrap items-center gap-x-5 gap-y-1">
                            <span>文件：{parsedArchitecture.fileName}</span>
                            <span>Sheet：{parsedArchitecture.sheetName}</span>
                            <span>源行数：{parsedArchitecture.sourceRows}</span>
                            <span>有效权限：{parsedArchitecture.parsedRows}</span>
                            <span>空行跳过：{parsedArchitecture.skippedEmptyRows}</span>
                        </div>
                        <div className="px-4 py-2 border-b border-slate-100 bg-white flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => scrollPreview('architecture', 'left')}
                                className="med-btn-sm med-button-secondary"
                            >
                                向左滑
                            </button>
                            <button
                                type="button"
                                onClick={() => scrollPreview('architecture', 'right')}
                                className="med-btn-sm med-button-secondary"
                            >
                                向右滑
                            </button>
                        </div>
                        <div ref={architecturePreviewScrollRef} className="overflow-auto max-h-[440px]">
                            <table className="min-w-[1020px] w-full text-sm">
                                <thead className="bg-slate-50 text-slate-600">
                                    <tr>
                                        <th className="text-left px-3 py-2">行号</th>
                                        <th className="text-left px-3 py-2">SG</th>
                                        <th className="text-left px-3 py-2">RM</th>
                                        <th className="text-left px-3 py-2">DM</th>
                                        <th className="text-left px-3 py-2">MICS</th>
                                        <th className="text-left px-3 py-2">医院名称</th>
                                        <th className="text-left px-3 py-2">医院编码</th>
                                        <th className="text-left px-3 py-2">省份</th>
                                        <th className="text-left px-3 py-2">启用</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {parsedArchitecture.previewRows.map((row) => (
                                        <tr key={`${row.rowNumber}-${row.hospitalCode}-${row.province}`}>
                                            <td className="px-3 py-2">{row.rowNumber}</td>
                                            <td className="px-3 py-2">{row.sg}</td>
                                            <td className="px-3 py-2">{row.rm}</td>
                                            <td className="px-3 py-2">{row.dm}</td>
                                            <td className="px-3 py-2">{row.mics}</td>
                                            <td className="px-3 py-2">{row.hospitalName}</td>
                                            <td className="px-3 py-2 font-mono">{row.hospitalCode}</td>
                                            <td className="px-3 py-2">{row.province}</td>
                                            <td className="px-3 py-2">{row.isActive ? 'true' : 'false'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
