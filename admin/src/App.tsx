import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/context';
import { Layout } from './components/Layout';
import { ErrorState, Loading } from './components/ui';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import TreasuryPage from './pages/TreasuryPage';
import UsersPage from './pages/UsersPage';
import CategoriesPage from './pages/CategoriesPage';
import JobsPage from './pages/JobsPage';
import TransactionsPage from './pages/TransactionsPage';
import MediationPage from './pages/MediationPage';
import PromotionsPage from './pages/PromotionsPage';
import SettingsPage from './pages/SettingsPage';
import AuditLogPage from './pages/AuditLogPage';

function RequireAdmin({ children }: { children: JSX.Element }) {
  const { status, retry } = useAuth();
  const loc = useLocation();
  if (status === 'checking') return <Loading label="Vérification de la session…" />;
  if (status === 'unreachable')
    return (
      <div style={{ padding: 24 }}>
        <ErrorState error={new Error("Le serveur Tasko ne répond pas. Votre session est conservée : réessayez dans un instant.")} onRetry={retry} />
      </div>
    );
  if (status !== 'authenticated') return <Navigate to="/connexion" replace state={{ from: loc.pathname }} />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/connexion" element={<LoginPage />} />
      <Route
        element={
          <RequireAdmin>
            <Layout />
          </RequireAdmin>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="tresorerie" element={<TreasuryPage />} />
        <Route path="utilisateurs" element={<UsersPage key="users" mode="users" />} />
        <Route path="prestataires" element={<UsersPage key="providers" mode="providers" />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="missions" element={<JobsPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="mediation" element={<MediationPage />} />
        <Route path="avis-litiges" element={<Navigate to="/mediation" replace />} />
        <Route path="promotions" element={<PromotionsPage />} />
        <Route path="parametres" element={<SettingsPage />} />
        <Route path="journal" element={<AuditLogPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
