import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import type { ReactNode } from "react";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "checking") {
    return (
      <div className="auth-shell">
        <div className="panel status-screen">
          <p className="auth-eyebrow">Admin access only</p>
          <h1 className="page-title">Checking admin session</h1>
          <p className="supporting-text">
            Confirming access before loading the production operations dashboard.
          </p>
        </div>
      </div>
    );
  }

  if (status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
