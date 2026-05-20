import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { DashboardShell } from "./components/DashboardShell";
import type { ThemeMode } from "./components/ThemeToggle";
import { useAuth } from "./auth";
import { LoginPage } from "./pages/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { PendingMerchantsPage } from "./pages/PendingMerchantsPage";
import { PendingCashoutsPage } from "./pages/PendingCashoutsPage";

const THEME_STORAGE_KEY = "oneto-admin-theme";

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === "dark" ? "dark" : "light";
}

function AdminLayout({
  theme,
  onToggleTheme,
}: {
  theme: ThemeMode;
  onToggleTheme: () => void;
}) {
  const { logout } = useAuth();

  return (
    <DashboardShell theme={theme} onToggleTheme={onToggleTheme} onLogout={() => void logout()}>
      <div className="route-content">
        <Routes>
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/merchants/pending" element={<PendingMerchantsPage />} />
          <Route path="/cashouts/pending" element={<PendingCashoutsPage />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </div>
    </DashboardShell>
  );
}

export function App() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return (
    <Routes>
      <Route
        path="/login"
        element={<LoginPage theme={theme} onToggleTheme={() => setTheme(theme === "light" ? "dark" : "light")} />}
      />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <AdminLayout
              theme={theme}
              onToggleTheme={() => setTheme(theme === "light" ? "dark" : "light")}
            />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
