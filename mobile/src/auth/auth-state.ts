import { createContext, useContext } from "react";
import type { Me } from "../api/auth";

// Single source of truth for "is the user signed in." Provided at the root
// layout. Components consume via useAuth().
//
// We use Context (not zustand) here because the surface is tiny and React's
// built-in primitives are enough. zustand was on the optional list for 2.1
// and we don't need its features yet.

export type AuthStatus = "loading" | "unauthed" | "authed";

export interface AuthState {
  readonly status: AuthStatus;
  readonly user: Me | null;
  signIn: (token: string, user: Me) => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
