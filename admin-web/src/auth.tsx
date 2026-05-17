import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type AuthContextValue = {
  token: string | null;
  setToken: (token: string) => void;
  clearToken: () => void;
};

const SESSION_STORAGE_KEY = "oneto_admin_access_token";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readTokenFromSession(): string | null {
  const token = sessionStorage.getItem(SESSION_STORAGE_KEY);
  return token && token.length > 0 ? token : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => readTokenFromSession());

  const setToken = (nextToken: string) => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, nextToken);
    setTokenState(nextToken);
  };

  const clearToken = () => {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    setTokenState(null);
  };

  const value = useMemo(
    () => ({ token, setToken, clearToken }),
    [token],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return {
    token: ctx.token,
    setToken: ctx.setToken,
    clearToken: ctx.clearToken,
    logout: ctx.clearToken,
  };
}
