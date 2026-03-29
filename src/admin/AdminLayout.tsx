import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { LayoutDashboard, Settings2, Database, LogOut, ShieldAlert, Users, UserCheck } from 'lucide-react';
import { useAppStore } from '../lib/store';

interface NavItem {
    to: string;
    icon: typeof LayoutDashboard;
    label: string;
}

export default function AdminLayout() {
    const navigate = useNavigate();
    const location = useLocation();
    const { adminSession, clearAdminSession } = useAppStore();

    const navItems = useMemo(() => {
        if (!adminSession) return [];

        return [
            adminSession.permissions.dashboard
                ? { to: '/admin/dashboard', icon: LayoutDashboard, label: '数据中心' }
                : null,
            adminSession.permissions.questions
                ? { to: '/admin/questions', icon: Settings2, label: '题库管理' }
                : null,
            adminSession.permissions.strategies
                ? { to: '/admin/strategies', icon: ShieldAlert, label: '分型与策略' }
                : null,
            (adminSession.role === 'super_admin' || adminSession.permissions.employeeAuth)
                ? { to: '/admin/employee-access', icon: UserCheck, label: '员工登录库' }
                : null,
            adminSession.role === 'super_admin'
                ? { to: '/admin/permissions', icon: Users, label: '权限管理' }
                : null,
        ].filter((item): item is NavItem => item !== null);
    }, [adminSession]);

    useEffect(() => {
        if (navItems.length === 0) {
            navigate('/admin/login', { replace: true });
            return;
        }

        const isCurrentAllowed = navItems.some((item) => location.pathname.startsWith(item.to));
        if (!isCurrentAllowed) {
            navigate(navItems[0].to, { replace: true });
        }
    }, [location.pathname, navItems, navigate]);

    const roleLabel = adminSession?.role === 'super_admin'
        ? '超级管理员'
        : adminSession?.role === 'viewer'
            ? '只读管理员'
            : '管理员';

    const handleAdminLogout = () => {
        clearAdminSession();
        navigate('/admin/login', { replace: true });
    };

    return (
        <div className="flex h-screen overflow-hidden">
            {/* 侧边栏 */}
            <aside className="w-64 text-slate-100 flex flex-col shadow-xl z-20 shrink-0 bg-gradient-to-b from-[#0f4cb8] via-[#1164c8] to-[#0b4f9d] border-r border-blue-300/25">
                <div className="h-16 flex items-center px-6 border-b border-white/10">
                    <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur flex items-center justify-center mr-3">
                        <Database className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-white font-extrabold text-lg tracking-wide">VPS Admin</span>
                </div>

                <div className="flex-1 py-6 px-4 space-y-2">
                    <div className="px-3 mb-2 text-xs font-bold text-blue-100/70 uppercase tracking-wider">系统导航</div>
                    {navItems.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            className={({ isActive }) =>
                                `flex items-center px-3 py-3 rounded-xl transition-all duration-200 group ${isActive
                                    ? 'bg-white/22 text-white shadow-lg shadow-blue-950/25 font-semibold backdrop-blur-sm border border-white/20'
                                    : 'text-blue-100/85 hover:bg-white/12 hover:text-white border border-transparent'
                                }`
                            }
                        >
                            <item.icon className="w-5 h-5 mr-3 shrink-0" />
                            {item.label}
                        </NavLink>
                    ))}
                </div>

                <div className="p-4 border-t border-white/10">
                    <button
                        onClick={handleAdminLogout}
                        className="flex items-center w-full px-3 py-3 text-blue-100/80 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
                    >
                        <LogOut className="w-5 h-5 mr-3" />
                        退出后台
                    </button>
                    <button
                        onClick={() => navigate('/')}
                        className="mt-2 flex items-center w-full px-3 py-3 text-blue-100/80 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
                    >
                        <Database className="w-5 h-5 mr-3" />
                        去前台
                    </button>
                </div>
            </aside>

            {/* 主内容区域 */}
            <main className="flex-1 flex flex-col relative overflow-hidden">
                {/* 顶部简易导航区 */}
                <header className="h-16 med-panel-soft border-b border-blue-100 flex items-center px-8 justify-between z-10 shrink-0">
                    <div>
                        <h2 className="med-title-md text-slate-800">管理看板</h2>
                        <p className="med-subtitle text-slate-500 text-xs -mt-0.5">VPS Cloud Console</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm">
                            {adminSession?.employeeName?.slice(0, 1) || 'AD'}
                        </span>
                        <div className="text-sm text-slate-600">
                            <div className="font-medium">{adminSession?.employeeName || '系统管理员'}</div>
                            <div className="text-xs text-slate-400">{roleLabel}</div>
                        </div>
                    </div>
                </header>

                {/* 业务页面出口 */}
                <div className="flex-1 overflow-auto p-8 bg-transparent">
                    <div className="max-w-6xl mx-auto">
                        <Outlet />
                    </div>
                </div>
            </main>
        </div>
    );
}
