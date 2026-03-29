import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { lazy, Suspense, type ReactElement } from 'react';
import AuthPage from './pages/AuthPage';
import AdminLayout from './admin/AdminLayout';
import { useAppStore } from './lib/store';

const SelectPage = lazy(() => import('./pages/SelectPage'));
const SurveyPage = lazy(() => import('./pages/SurveyPage'));
const ResultPage = lazy(() => import('./pages/ResultPage'));

const DataCenterPage = lazy(() => import('./admin/DataCenterPage'));
const QuestionConfigPage = lazy(() => import('./admin/QuestionConfigPage'));
const StrategyConfigPage = lazy(() => import('./admin/StrategyConfigPage'));
const AdminLoginPage = lazy(() => import('./admin/AdminLoginPage'));
const AdminPermissionsPage = lazy(() => import('./admin/AdminPermissionsPage'));
const EmployeeAuthConfigPage = lazy(() => import('./admin/EmployeeAuthConfigPage'));

function RequireEmployeeAuth({ children }: { children: ReactElement }) {
  const location = useLocation();
  const employeeSession = useAppStore((state) => state.employeeSession);

  if (!employeeSession) {
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  }

  return children;
}

function RequireAdminAuth({ children }: { children: ReactElement }) {
  const location = useLocation();
  const adminSession = useAppStore((state) => state.adminSession);

  if (!adminSession) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

function RequireSuperAdmin({ children }: { children: ReactElement }) {
  const adminSession = useAppStore((state) => state.adminSession);

  if (!adminSession) {
    return <Navigate to="/admin/login" replace />;
  }

  if (adminSession.role !== 'super_admin') {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return children;
}

function RequireEmployeeAuthManager({ children }: { children: ReactElement }) {
  const adminSession = useAppStore((state) => state.adminSession);

  if (!adminSession) {
    return <Navigate to="/admin/login" replace />;
  }

  if (adminSession.role === 'super_admin' || adminSession.permissions.employeeAuth) {
    return children;
  }

  return <Navigate to="/admin/dashboard" replace />;
}

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen overflow-x-hidden text-slate-900 med-page">
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-600 text-sm">加载中...</div>}>
          <Routes>
          {/* H5 端路由 */}
          <Route path="/" element={<Navigate to="/auth" replace />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route
            path="/select"
            element={
              <RequireEmployeeAuth>
                <SelectPage />
              </RequireEmployeeAuth>
            }
          />
          <Route
            path="/survey/:hospitalId"
            element={
              <RequireEmployeeAuth>
                <SurveyPage />
              </RequireEmployeeAuth>
            }
          />
          <Route
            path="/result/:hospitalId"
            element={
              <RequireEmployeeAuth>
                <ResultPage />
              </RequireEmployeeAuth>
            }
          />

          {/* PC 后台路由 */}
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/admin" element={<RequireAdminAuth><AdminLayout /></RequireAdminAuth>}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<DataCenterPage />} />
            <Route path="questions" element={<QuestionConfigPage />} />
            <Route path="strategies" element={<StrategyConfigPage />} />
            <Route
              path="employee-access"
              element={
                <RequireEmployeeAuthManager>
                  <EmployeeAuthConfigPage />
                </RequireEmployeeAuthManager>
              }
            />
            <Route
              path="permissions"
              element={
                <RequireSuperAdmin>
                  <AdminPermissionsPage />
                </RequireSuperAdmin>
              }
            />
          </Route>
        </Routes>
        </Suspense>
      </div>
    </BrowserRouter>
  );
}

export default App;
