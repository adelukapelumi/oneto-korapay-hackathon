import { Navigate, Route, Routes, NavLink } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { useAuth } from "./auth";
import { LoginPage } from "./pages/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { PendingMerchantsPage } from "./pages/PendingMerchantsPage";
import { PendingCashoutsPage } from "./pages/PendingCashoutsPage";

function AdminLayout() {
  const { logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>oneto Admin</h1>
        <button type="button" onClick={() => void logout()}>
          Logout
        </button>
      </header>
      <nav className="tabs">
        <NavLink to="/overview" className={({ isActive }) => (isActive ? "tab active" : "tab")}>
          Overview
        </NavLink>
        <NavLink
          to="/merchants/pending"
          className={({ isActive }) => (isActive ? "tab active" : "tab")}
        >
          Pending Merchants
        </NavLink>
        <NavLink
          to="/cashouts/pending"
          className={({ isActive }) => (isActive ? "tab active" : "tab")}
        >
          Pending Cashouts
        </NavLink>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/merchants/pending" element={<PendingMerchantsPage />} />
          <Route path="/cashouts/pending" element={<PendingCashoutsPage />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
