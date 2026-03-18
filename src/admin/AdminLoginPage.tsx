import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, UserRound, BadgeCheck, Loader2, LogIn } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { verifyAdminAccess } from '../lib/adminAuth';

export default function AdminLoginPage() {
    const navigate = useNavigate();
    const { adminSession, saveAdminSession } = useAppStore();

    const [employeeName, setEmployeeName] = useState('');
    const [employeeId, setEmployeeId] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorText, setErrorText] = useState('');

    useEffect(() => {
        if (adminSession) {
            navigate('/admin/dashboard', { replace: true });
        }
    }, [adminSession, navigate]);

    const canSubmit = useMemo(() => {
        return employeeName.trim().length > 0 && employeeId.trim().length > 0 && !isSubmitting;
    }, [employeeName, employeeId, isSubmitting]);

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!canSubmit) return;

        setErrorText('');
        setIsSubmitting(true);

        try {
            const result = await verifyAdminAccess(employeeName, employeeId);
            if (!result.isValid) {
                setErrorText('登录失败：账号不存在或无后台权限。');
                return;
            }

            const isSuperAdmin = result.role === 'super_admin';
            const normalizedPermissions = isSuperAdmin
                ? {
                    dashboard: true,
                    dataManage: true,
                    questions: true,
                    strategies: true,
                }
                : result.permissions;

            const hasAnyPermission = normalizedPermissions.dashboard
                || normalizedPermissions.questions
                || normalizedPermissions.strategies;
            if (!hasAnyPermission) {
                setErrorText('登录成功，但该账号未分配任何后台菜单权限。');
                return;
            }

            saveAdminSession({
                employeeName: result.employeeName,
                employeeId: result.employeeId,
                role: result.role,
                permissions: normalizedPermissions,
                loggedInAt: Date.now(),
            });

            navigate('/admin/dashboard', { replace: true });
        } catch (error) {
            const message = error instanceof Error ? error.message : '未知错误';
            setErrorText(`登录异常：${message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center px-4 py-8">
            <div className="w-full max-w-md rounded-3xl overflow-hidden med-panel">
                <div className="med-hero px-7 py-8 relative overflow-hidden">
                    <div className="absolute -right-12 -top-10 w-44 h-44 rounded-full bg-white/20 blur-3xl" />
                    <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center mb-4 med-pulse">
                        <ShieldCheck className="w-6 h-6" />
                    </div>
                    <h1 className="med-title-lg text-white">后台管理员登录</h1>
                    <p className="med-subtitle-light mt-2">
                        输入员工姓名与员工号，通过管理员白名单校验后进入后台。
                    </p>
                </div>

                <form className="px-7 py-7 space-y-4" onSubmit={handleSubmit}>
                    <label className="block">
                        <div className="text-sm font-semibold text-slate-700 mb-2">员工姓名</div>
                        <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 med-input">
                            <UserRound className="w-4 h-4 text-blue-500" />
                            <input
                                type="text"
                                value={employeeName}
                                onChange={(event) => setEmployeeName(event.target.value)}
                                placeholder="例如：张伟经理"
                                className="w-full bg-transparent outline-none text-slate-800 placeholder:text-slate-400"
                                autoComplete="off"
                            />
                        </div>
                    </label>

                    <label className="block">
                        <div className="text-sm font-semibold text-slate-700 mb-2">员工号</div>
                        <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 med-input">
                            <BadgeCheck className="w-4 h-4 text-blue-500" />
                            <input
                                type="text"
                                value={employeeId}
                                onChange={(event) => setEmployeeId(event.target.value)}
                                placeholder="例如：EMP_ZW01"
                                className="w-full bg-transparent outline-none text-slate-800 placeholder:text-slate-400"
                                autoComplete="off"
                            />
                        </div>
                    </label>

                    {errorText && (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-3 py-2.5">
                            {errorText}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={!canSubmit}
                        className="w-full mt-2 med-btn med-button-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                登录中...
                            </>
                        ) : (
                            <>
                                <LogIn className="w-4 h-4" />
                                进入后台
                            </>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}
