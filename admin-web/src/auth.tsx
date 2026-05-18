import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getAdminSession, logoutAdmin } from "./api";

export type AuthStatus = "checking" | "authenticated" | "anonymous";

type AuthContextValue = {
  status: AuthStatus;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
  markAnonymous: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking");

  const markAnonymous = useCallback(() => {
    setStatus("anonymous");
  }, []);

  const refreshSession = useCallback(async () => {
    setStatus("checking");
    try {
      await getAdminSession(markAnonymous);
      setStatus("authenticated");
    } catch {
      setStatus("anonymous");
    }
  }, [markAnonymous]);

  const logout = useCallback(async () => {
    try {
      await logoutAdmin();
    } finally {
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const value = useMemo(
    () => ({
      status,
      refreshSession,
      logout,
      markAnonymous,
    }),
    [status, refreshSession, logout, markAnonymous],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
