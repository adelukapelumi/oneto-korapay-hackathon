import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState as RNAppState, type AppStateStatus } from "react-native";
import { fetchMe, requestOtp, type Me } from "../api/auth";
import { setUnauthorizedHandler } from "../api/client";
import { NetworkError } from "../api/errors";
import {
  clearAttempts,
  hasKeypair,
  hasPendingRecoveryKeypair,
  unlockKeypairWithPin,
  wipeKeypair,
  wipePendingRecoveryKeypair,
} from "../crypto/pin-derive";
import { logger } from "../lib/logger";
import { clearToken, getToken, setToken } from "./token-store";
import { isJwtExpired } from "./jwt-decode";
import { AuthContext, type AppState, type AuthState } from "./auth-state";
import { initDb, wipeLocalTestingData } from "../ledger/db";
import {
  isUserNotFoundError,
  resetLocalAuthAfterMissingUser,
} from "./bootstrap-recovery";
import {
  clearCachedMeProfile,
  isRealMeProfile,
  loadCachedMeProfile,
  persistMeProfile,
} from "./profile-cache";
import { toLockedOrUnauthed, unlockLockedState } from "./auth-transitions";
import {
  resetLocalAppForTesting as resetLocalAppStorageForTesting,
  wipeLocalPaymentKeyOnlyForTesting as wipeLocalPaymentKeyStorageOnlyForTesting,
} from "./local-test-reset";

interface ProviderProps {
  readonly children: React.ReactNode;
}

// 5 minutes in background -> re-prompt for PIN on resume. Short enough to
// be useful against an opportunistic phone-snatcher; long enough not to
// punish a user who briefly checked another app.
const BACKGROUND_LOCK_MS = 5 * 60 * 1000;

// Re-check JWT freshness this often while authed. 60s is a sensible
// balance: short enough that the UI surfaces the "sign in again" banner
// without the user having to navigate, long enough not to thrash.
const JWT_FRESHNESS_INTERVAL_MS = 60 * 1000;

export function AuthProvider({ children }: ProviderProps): React.ReactElement {
  const [state, setState] = useState<AppState>({ status: "loading" });
  const isMounted = useRef(true);

  // Decrypted private key. Held in a ref (NOT React state) so it never
  // enters component snapshots, devtools, or React's commit history.
  // Cleared on lock() and signOut().
  const decryptedPrivateKey = useRef<Uint8Array | null>(null);
  const pendingRecoveryKeypair = useRef<{
    readonly privateKey: Uint8Array;
    readonly publicKey: string;
  } | null>(null);

  // Background timestamp for the AppState lock timer. Set when we go to
  // background, consulted on resume.
  const backgroundedAtMs = useRef<number | null>(null);

  const wipeInMemoryKey = useCallback(() => {
    if (decryptedPrivateKey.current) {
      // Best-effort zeroization. JS can't guarantee the GC won't have
      // already kept a copy, but this at least clears the active reference.
      decryptedPrivateKey.current.fill(0);
      decryptedPrivateKey.current = null;
    }
  }, []);

  const clearPendingRecoveryKeypair = useCallback(() => {
    if (pendingRecoveryKeypair.current) {
      pendingRecoveryKeypair.current.privateKey.fill(0);
      pendingRecoveryKeypair.current = null;
    }
  }, []);

  const resetLocalAuthForMissingUser = useCallback(async () => {
    await resetLocalAuthAfterMissingUser({
      clearTokenFn: clearToken,
      clearAttemptsFn: clearAttempts,
      wipeKeypairFn: wipeKeypair,
      wipeInMemoryKeyFn: wipeInMemoryKey,
    });
  }, [wipeInMemoryKey]);

  const signOut = useCallback(async () => {
    await clearToken();
    wipeInMemoryKey();
    if (!isMounted.current) return;
    // If a keypair exists on disk, go to locked (not unauthed). This
    // prevents the email input screen from being reachable - the user
    // re-enters their PIN for offline use, then taps re-authenticate
    // (which sends OTP to their stored email, not a free-text input).
    const keypairPresent = await hasKeypair();
    if (!isMounted.current) return;
    if (keypairPresent) {
      setState((prev) => {
        const user =
          prev.status === "authed" ||
          prev.status === "locked" ||
          prev.status === "onboarding" ||
          prev.status === "recovery_pending"
            ? prev.user
            : null;
        return toLockedOrUnauthed(user, {
          hasJwt: false,
          jwtFreshAfterUnlock: false,
        });
      });
    } else {
      setState({ status: "unauthed" });
    }
  }, [wipeInMemoryKey]);

  const wipeLocalPaymentKeyOnlyForTesting = useCallback(async () => {
    await wipeLocalPaymentKeyStorageOnlyForTesting();
    wipeInMemoryKey();
    if (!isMounted.current) return;
    setState((prev) => {
      if (prev.status !== "authed") {
        return prev;
      }
      return { status: "onboarding", user: prev.user };
    });
  }, [wipeInMemoryKey]);

  const resetLocalAppForTesting = useCallback(async () => {
    await resetLocalAppStorageForTesting({
      clearTokenFn: clearToken,
      wipeActiveKeypairFn: wipeKeypair,
      wipePendingRecoveryKeypairFn: wipePendingRecoveryKeypair,
      clearCachedProfileFn: clearCachedMeProfile,
      wipeSqliteLocalDataFn: wipeLocalTestingData,
      wipeInMemoryKeyFn: wipeInMemoryKey,
      clearInMemoryPendingRecoveryKeypairFn: clearPendingRecoveryKeypair,
    });
    if (!isMounted.current) return;
    setState({ status: "unauthed" });
  }, [clearPendingRecoveryKeypair, wipeInMemoryKey]);

  const signIn = useCallback(
    async (token: string, nextUser: Me) => {
      if (!isRealMeProfile(nextUser)) {
        throw new Error("Cannot sign in with an invalid user profile");
      }
      await setToken(token);
      persistMeProfile(nextUser);
      if (!isMounted.current) return;
      const [keypairPresent, pendingRecoveryKeypairPresent] = await Promise.all(
        [hasKeypair(), hasPendingRecoveryKeypair()],
      );
      if (!isMounted.current) return;
      if (pendingRecoveryKeypairPresent) {
        setState({ status: "recovery_pending", user: nextUser });
        return;
      }
      if (!keypairPresent) {
        setState({ status: "onboarding", user: nextUser });
        return;
      }
      const fresh = !isJwtExpired(token);
      setState({ status: "authed", user: nextUser, jwtFresh: fresh });
    },
    [],
  );

  const completeOnboarding = useCallback(
    (privateKey: Uint8Array, _publicKey: string) => {
      if (!isMounted.current) return;
      setState((prev) => {
        if (
          prev.status !== "onboarding" &&
          prev.status !== "recovery_pending"
        ) {
          return prev;
        }
        decryptedPrivateKey.current = new Uint8Array(privateKey);
        clearPendingRecoveryKeypair();
        return { status: "authed", user: prev.user, jwtFresh: true };
      });
    },
    [clearPendingRecoveryKeypair],
  );

  const stagePendingRecoveryKeypair = useCallback(
    (privateKey: Uint8Array, publicKey: string) => {
      clearPendingRecoveryKeypair();
      pendingRecoveryKeypair.current = { privateKey, publicKey };
    },
    [clearPendingRecoveryKeypair],
  );

  const unlock = useCallback(async (pin: string) => {
    // unlockKeypairWithPin throws PinIncorrectError, PinLockedError, or
    // a generic Error if no keypair is stored. Callers handle.
    const { privateKey } = await unlockKeypairWithPin(pin);
    await clearAttempts();
    const token = await getToken();
    if (!isMounted.current) {
      privateKey.fill(0);
      return;
    }
    decryptedPrivateKey.current = privateKey;
    setState((prev) => {
      if (prev.status === "locked") {
        const nextState = unlockLockedState(prev, token);
        if (nextState.status !== "authed") {
          privateKey.fill(0);
          decryptedPrivateKey.current = null;
        }
        return nextState;
      }
      return prev;
    });
  }, []);

  const lock = useCallback(() => {
    wipeInMemoryKey();
    if (!isMounted.current) return;
    setState((prev) => {
      if (prev.status === "authed") {
        return {
          status: "locked",
          user: prev.user,
          hasJwt: prev.jwtFresh,
        };
      }
      return prev;
    });
  }, [wipeInMemoryKey]);

  const getDecryptedPrivateKey = useCallback(
    () => decryptedPrivateKey.current,
    [],
  );
  const getPendingRecoveryKeypair = useCallback(
    () => pendingRecoveryKeypair.current,
    [],
  );

  // ----- Bootstrap -----
  useEffect(() => {
    isMounted.current = true;
    initDb();

    setUnauthorizedHandler(() => {
      if (!isMounted.current) return;
      // 401 from any request: clear in-memory key. Don't drop the
      // keypair on disk - the user just needs to sign back in.
      wipeInMemoryKey();
      void (async () => {
        await clearToken();
        const [keypairPresent, pendingRecoveryKeypairPresent] =
          await Promise.all([hasKeypair(), hasPendingRecoveryKeypair()]);
        if (!isMounted.current) return;
        if (pendingRecoveryKeypairPresent) {
          setState((prev) => {
            const user =
              prev.status === "authed" ||
              prev.status === "locked" ||
              prev.status === "onboarding" ||
              prev.status === "recovery_pending"
                ? prev.user
                : loadCachedMeProfile();
            if (!user) {
              return { status: "unauthed" };
            }
            return { status: "recovery_pending", user };
          });
          return;
        }
        if (!keypairPresent) {
          setState({ status: "unauthed" });
        } else {
          // Keypair exists: go to locked, not unauthed. This prevents
          // the email input screen from being reachable. Preserve the
          // user object so the stored email is available for re-auth.
          setState((prev) => {
            const user =
              prev.status === "authed" ||
              prev.status === "locked" ||
              prev.status === "onboarding" ||
              prev.status === "recovery_pending"
                ? prev.user
                : loadCachedMeProfile();
            return toLockedOrUnauthed(user, {
              hasJwt: false,
              jwtFreshAfterUnlock: false,
            });
          });
        }
      })();
    });

    void (async () => {
      try {
        const [keypairPresent, pendingRecoveryKeypairPresent, token] =
          await Promise.all([
            hasKeypair(),
            hasPendingRecoveryKeypair(),
            getToken(),
          ]);

        if (!keypairPresent && !pendingRecoveryKeypairPresent && !token) {
          if (!isMounted.current) return;
          setState({ status: "unauthed" });
          return;
        }

        if (!keypairPresent && pendingRecoveryKeypairPresent && !token) {
          if (!isMounted.current) return;
          setState({ status: "unauthed" });
          return;
        }

        if (!keypairPresent && !pendingRecoveryKeypairPresent && token) {
          // Verified OTP, then app was killed before keypair setup.
          // Re-fetch the user (best effort) so we can show onboarding.
          let user: Me | null = null;
          try {
            user = await fetchMe();
            persistMeProfile(user);
          } catch (err) {
            if (isUserNotFoundError(err)) {
              await resetLocalAuthForMissingUser();
              if (!isMounted.current) return;
              setState({ status: "unauthed" });
              return;
            }
            // If offline at boot, we still proceed to onboarding -
            // the user can complete PIN setup; key registration will
            // retry until network is back.
            if (!(err instanceof NetworkError)) {
              logger.info("fetchMe during boot failed", err);
            }
          }
          if (!isMounted.current) return;
          if (user) {
            setState({ status: "onboarding", user });
          } else {
            // No user object available. Drop the token; force re-OTP.
            await clearToken();
            if (!isMounted.current) return;
            setState({ status: "unauthed" });
          }
          return;
        }

        if (!keypairPresent && pendingRecoveryKeypairPresent && token) {
          // A recovery request is in progress on this device. Keep the user
          // out of the main app until support approves the new key.
          let user: Me | null = null;
          try {
            user = await fetchMe();
            persistMeProfile(user);
          } catch (err) {
            if (isUserNotFoundError(err)) {
              await resetLocalAuthForMissingUser();
              if (!isMounted.current) return;
              setState({ status: "unauthed" });
              return;
            }
            if (!(err instanceof NetworkError)) {
              logger.info("fetchMe during recovery bootstrap failed", err);
            }
          }
          if (!isMounted.current) return;
          if (user) {
            setState({ status: "recovery_pending", user });
          } else {
            await clearToken();
            if (!isMounted.current) return;
            setState({ status: "unauthed" });
          }
          return;
        }

        if (keypairPresent && !token) {
          // Returning user, no JWT. Locked state with hasJwt=false; the
          // PIN entry screen unlocks the key for offline use, and the
          // home screen will show "sign in again" for online actions.
          // We need a real profile for offline unlock. Without a cached
          // profile, force sign-in instead of letting a placeholder identity
          // reach the payment surface.
          if (!isMounted.current) return;
          const cachedUser = loadCachedMeProfile();
          setState(toLockedOrUnauthed(cachedUser, {
            hasJwt: false,
            jwtFreshAfterUnlock: false,
          }));
          return;
        }

        // keypairPresent && token: try to verify the token freshness
        // and (best effort) refresh the user record. Network errors
        // here must NOT bounce us to unauthed - that's the offline-boot
        // bug fix from 2.1. Treat the token as fresh-enough for now;
        // the freshness check on unlock will re-evaluate.
        if (token === null) return;
        let user: Me | null = null;
        let jwtFreshAfterUnlock: boolean | undefined;
        try {
          user = await fetchMe();
          persistMeProfile(user);
        } catch (err) {
          if (err instanceof NetworkError) {
            logger.info(
              "Offline at boot; treating stored token as valid for now",
            );
            user = loadCachedMeProfile();
            jwtFreshAfterUnlock = false;
          } else if (isUserNotFoundError(err)) {
            await resetLocalAuthForMissingUser();
            if (!isMounted.current) return;
            setState({ status: "unauthed" });
            return;
          } else {
            // 401 -> interceptor will clear the token; propagate to
            // unauthed via the unauthorized handler. Other errors:
            // use the cached real profile if available.
            logger.info("fetchMe during boot failed (non-network)", err);
            user = loadCachedMeProfile();
            jwtFreshAfterUnlock = false;
          }
        }
        if (!isMounted.current) return;
        if (!isRealMeProfile(user)) {
          await clearToken();
          if (!isMounted.current) return;
          setState({ status: "unauthed" });
          return;
        }
        setState({
          status: "locked",
          user,
          hasJwt: jwtFreshAfterUnlock ?? !isJwtExpired(token),
          jwtFreshAfterUnlock,
        });
      } catch (err) {
        // Unexpected boot error. Don't silently drop into unauthed
        // unless we genuinely have nothing.
        logger.warn("Auth bootstrap unexpected error", err);
        if (!isMounted.current) return;
        setState({ status: "unauthed" });
      }
    })();

    return () => {
      isMounted.current = false;
      setUnauthorizedHandler(null);
      wipeInMemoryKey();
      clearPendingRecoveryKeypair();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearPendingRecoveryKeypair, wipeInMemoryKey]);

  const hydrateProfile = useCallback((nextUser: Me): void => {
    if (!isRealMeProfile(nextUser)) {
      throw new Error("Cannot hydrate auth state with an invalid user profile");
    }

    persistMeProfile(nextUser);
    if (!isMounted.current) return;
    setState((prev) => {
      if (
        prev.status === "authed" ||
        prev.status === "onboarding" ||
        prev.status === "recovery_pending"
      ) {
        return { ...prev, user: nextUser };
      }
      if (prev.status === "locked") {
        return { ...prev, user: nextUser };
      }
      return prev;
    });
  }, []);

  const refreshProfileFromServer = useCallback(async (): Promise<void> => {
    try {
      const nextUser = await fetchMe();
      hydrateProfile(nextUser);
    } catch (err) {
      if (isUserNotFoundError(err)) {
        await resetLocalAuthForMissingUser();
        if (!isMounted.current) return;
        setState({ status: "unauthed" });
        return;
      }
      if (!(err instanceof NetworkError)) {
        logger.info("Profile refresh failed", err);
      }
    }
  }, [hydrateProfile, resetLocalAuthForMissingUser]);

  // ----- AppState background lock -----
  useEffect(() => {
    const sub = RNAppState.addEventListener(
      "change",
      (next: AppStateStatus) => {
        if (next === "background" || next === "inactive") {
          backgroundedAtMs.current = Date.now();
          return;
        }
        if (next === "active") {
          const since = backgroundedAtMs.current;
          backgroundedAtMs.current = null;
          if (since !== null && Date.now() - since > BACKGROUND_LOCK_MS) {
            // Long enough away that we re-prompt for PIN.
            lock();
            return;
          }
          if (state.status === "authed" && state.jwtFresh) {
            void refreshProfileFromServer();
          }
        }
      },
    );
    return () => {
      sub.remove();
    };
  }, [lock, refreshProfileFromServer, state]);

  // ----- Periodic JWT freshness re-check while authed -----
  useEffect(() => {
    if (state.status !== "authed") return;
    const id = setInterval(() => {
      void (async () => {
        const token = await getToken();
        if (!isMounted.current) return;
        const fresh = token !== null && !isJwtExpired(token);
        setState((prev) =>
          prev.status === "authed" && prev.jwtFresh !== fresh
            ? { ...prev, jwtFresh: fresh }
            : prev,
        );
      })();
    }, JWT_FRESHNESS_INTERVAL_MS);
    return () => clearInterval(id);
  }, [state.status]);

  // Re-authenticate using the stored email. Sends an OTP to the email
  // already on the user object - no free-text email input is shown.
  // Returns the email so the caller can navigate to the OTP verify screen.
  const reauthenticate = useCallback(async (): Promise<string> => {
    const email = (() => {
      const s = state;
      if (
        s.status === "authed" ||
        s.status === "locked" ||
        s.status === "onboarding" ||
        s.status === "recovery_pending"
      ) {
        return s.user.email;
      }
      return "";
    })();
    if (!email) {
      throw new Error(
        "Cannot re-authenticate: no stored email. The user must sign in from scratch.",
      );
    }
    await requestOtp(email);
    return email;
  }, [state]);

  const value = useMemo<AuthState>(
    () => ({
      state,
      signIn,
      completeOnboarding,
      stagePendingRecoveryKeypair,
      discardPendingRecoveryKeypair: clearPendingRecoveryKeypair,
      unlock,
      lock,
      signOut,
      wipeLocalPaymentKeyOnlyForTesting,
      resetLocalAppForTesting,
      hydrateProfile,
      reauthenticate,
      getDecryptedPrivateKey,
      getPendingRecoveryKeypair,
    }),
    [
      state,
      signIn,
      completeOnboarding,
      stagePendingRecoveryKeypair,
      clearPendingRecoveryKeypair,
      unlock,
      lock,
      signOut,
      wipeLocalPaymentKeyOnlyForTesting,
      resetLocalAppForTesting,
      hydrateProfile,
      reauthenticate,
      getDecryptedPrivateKey,
      getPendingRecoveryKeypair,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

