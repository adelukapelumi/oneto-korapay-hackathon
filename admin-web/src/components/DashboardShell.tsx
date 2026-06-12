import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { BrandLogo } from "./BrandLogo";
import { ThemeToggle, type ThemeMode } from "./ThemeToggle";

type DashboardShellProps = {
  children: ReactNode;
  onLogout: () => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
};

const navItems = [
  { to: "/overview", label: "Overview" },
  { to: "/merchants", label: "Merchants" },
  { to: "/cashouts/pending", label: "Pending Cashouts" },
  { to: "/recovery/pending", label: "Recovery Requests" },
];

export function DashboardShell({
  children,
  onLogout,
  theme,
  onToggleTheme,
}: DashboardShellProps) {
  const location = useLocation();
  const [isNavOpen, setIsNavOpen] = useState(false);

  useEffect(() => {
    setIsNavOpen(false);
  }, [location.pathname]);

  return (
    <div className={`dashboard-shell ${isNavOpen ? "nav-open" : ""}`}>
      <aside id="admin-sidebar" className="dashboard-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo-wrap">
            <BrandLogo theme="dark" className="sidebar-logo" alt="Oneto Admin logo" />
          </div>
          <div>
            <p className="sidebar-eyebrow">Oneto Admin</p>
            <h1>Operations Console</h1>
            <p className="sidebar-subtitle">Daily review for production approvals and platform health.</p>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Admin pages">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? "sidebar-link sidebar-link-active" : "sidebar-link"
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-note panel">
          <p className="sidebar-note-label">Operator note</p>
          <p className="sidebar-note-text">
            Review reconciliation health before approving merchant cashouts.
          </p>
        </div>
      </aside>

      <div
        className="dashboard-overlay"
        aria-hidden={!isNavOpen}
        onClick={() => setIsNavOpen(false)}
      />

      <div className="dashboard-main">
        <header className="dashboard-header">
          <div className="dashboard-header-main">
            <button
              type="button"
              className="nav-toggle"
              aria-expanded={isNavOpen}
              aria-controls="admin-sidebar"
              onClick={() => setIsNavOpen((current) => !current)}
            >
              Menu
            </button>

            <div>
              <p className="header-eyebrow">Admin workspace</p>
              <h2>Production operations</h2>
            </div>
          </div>

          <div className="dashboard-header-actions">
            <span className="environment-pill">Production</span>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <button type="button" className="secondary logout-button" onClick={onLogout}>
              Log out admin session
            </button>
          </div>
        </header>

        <main className="dashboard-content">{children}</main>
      </div>
    </div>
  );
}
