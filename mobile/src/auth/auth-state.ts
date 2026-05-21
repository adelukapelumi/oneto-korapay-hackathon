import { createContext, useContext } from "react";
import type { Me } from "../api/auth";

// AppState distinguishes the user's actual situation, not just "signed
// in or not." A returning user with a stored keypair but no fresh JWT
// is in "locked" - they can still use offline features after PIN entry,
// they just can't refresh server state.
//
//   loading      - bootstrapping (reading token + keypair from storage)
//   unauthed     - no token, no keypair -> email entry
//   onboarding   - verified OTP, no keypair -> PIN setup + key registration
//   recovery_pending - verified OTP, pending recovery keypair -> recovery UI
//   locked       - keypair exists, awaiting PIN entry
//   authed       - unlocked. jwtFresh gates online actions
//
// jwtFresh is decided by isJwtExpired(token) and refreshed periodically
// while authed. When false, online actions (top-up, /me refresh, key
// rotation) must show "sign in to continue" instead of executing.

export type AppState =
  | { readonly status: "loading" }
  | { readonly status: "unauthed" }
  | { readonly status: "onboarding"; readonly user: Me }
  | { readonly status: "recovery_pending"; readonly user: Me }
  | { readonly status: "locked"; readonly user: Me; readonly hasJwt: boolean }
  | { readonly status: "authed"; readonly user: Me; readonly jwtFresh: boolean };

export interface AuthState {
  readonly state: AppState;
  /** Called after OTP verify succeeds. Persists the JWT and decides next route. */
  signIn: (token: string, user: Me) => Promise<void>;
  /** Called after PIN setup + key registration or recovery activation completes. */
  completeOnboarding: (privateKey: Uint8Array, publicKey: string) => void;
  /** Holds a just-generated recovery keypair in memory for this session only. */
  stagePendingRecoveryKeypair: (
    privateKey: Uint8Array,
    publicKey: string,
  ) => void;
  discardPendingRecoveryKeypair: () => void;
  /** Called after the user enters a correct PIN on the locked screen. */
  unlock: (pin: string) => Promise<void>;
  /** Called by the AppState background timer or a manual lock action. */
  lock: () => void;
  /** Sign out: drop token + lock keypair (keypair stays on disk). */
  signOut: () => Promise<void>;
  /**
   * Re-authenticate using the stored email. Sends an OTP to
   * state.user.email - no free-text email input is shown. Returns the
   * email string so the caller can navigate to the OTP verify screen.
   * Throws if no stored email is available.
   */
  reauthenticate: () => Promise<string>;
  /**
   * Decrypted private key access for in-memory use only. Returns null when
   * locked or onboarding incomplete. NEVER returned to React state - this
   * accessor reads a useRef so the value never enters component snapshots.
   */
  getDecryptedPrivateKey: () => Uint8Array | null;
  getPendingRecoveryKeypair: () => {
    readonly privateKey: Uint8Array;
    readonly publicKey: string;
  } | null;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
