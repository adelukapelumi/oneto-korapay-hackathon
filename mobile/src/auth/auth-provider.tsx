import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState as RNAppState, type AppStateStatus } from "react-native";
import { fetchMe, requestOtp, type Me } from "../api/auth";
import { setUnauthorizedHandler } from "../api/client";
import { NetworkError } from "../api/errors";
import {
  clearAttempts,
  hasKeypair,
  unlockKeypairWithPin,
} from "../crypto/pin-derive";
import { logger } from "../lib/logger";
import { clearToken, getToken, setToken } from "./token-store";
import { isJwtExpired } from "./jwt-decode";
import { AuthContext, type AppState, type AuthState } from "./auth-state";
import { initDb, setLocalState } from "../ledger/db";

interface ProviderProps {
  readonly children: React.ReactNode;
}

// 5 minutes in background → re-prompt for PIN on resume. Short enough to
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

  const signOut = useCallback(async () => {
    await clearToken();
    wipeInMemoryKey();
    if (!isMounted.current) return;
    // If a keypair exists on disk, go to locked (not unauthed). This
    // prevents the email input screen from being reachable — the user
    // re-enters their PIN for offline use, then taps re-authenticate
    // (which sends OTP to their *stored* email, not a free-text input).
    const keypairPresent = await hasKeypair();
    if (!isMounted.current) return;
    if (keypairPresent) {
      setState((prev) => {
        const user =
          prev.status === "authed" ||
          prev.status === "locked" ||
          prev.status === "onboarding"
            ? prev.user
            : makePlaceholderMe();
        return { status: "locked", user, hasJwt: false };
      });
    } else {
      setState({ status: "unauthed" });
    }
  }, [wipeInMemoryKey]);

  const signIn = useCallback(
    async (token: string, nextUser: Me) => {
      await setToken(token);
      setLocalState("verified_balance_kobo", nextUser.verifiedBalanceKobo);
      setLocalState("last_sync_at", new Date().toISOString());
      if (!isMounted.current) return;
      // Decide where this user goes next. The brief: after OTP verify,
      // if no keypair on this device → onboarding; else → home (the
      // user is already unlocked from the just-completed OTP flow).
      const keypairPresent = await hasKeypair();
      if (!isMounted.current) return;
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
        if (prev.status !== "onboarding") return prev;
        decryptedPrivateKey.current = privateKey;
        return { status: "authed", user: prev.user, jwtFresh: true };
      });
    },
    [],
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
        const fresh = token !== null && !isJwtExpired(token);
        return { status: "authed", user: prev.user, jwtFresh: fresh };
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

  // ----- Bootstrap -----
  useEffect(() => {
    isMounted.current = true;
    initDb();

    setUnauthorizedHandler(() => {
      if (!isMounted.current) return;
      // 401 from any request: clear in-memory key. Don't drop the
      // keypair on disk — the user just needs to sign back in.
      wipeInMemoryKey();
      void (async () => {
        await clearToken();
        const keypairPresent = await hasKeypair();
        if (!isMounted.current) return;
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
              prev.status === "onboarding"
                ? prev.user
                : makePlaceholderMe();
            return { status: "locked", user, hasJwt: false };
          });
        }
      })();
    });

    void (async () => {
      try {
        const [keypairPresent, token] = await Promise.all([
          hasKeypair(),
          getToken(),
        ]);

        if (!keypairPresent && !token) {
          if (!isMounted.current) return;
          setState({ status: "unauthed" });
          return;
        }

        if (!keypairPresent && token) {
          // Verified OTP, then app was killed before keypair setup.
          // Re-fetch the user (best effort) so we can show onboarding.
          let user: Me | null = null;
          try {
            user = await fetchMe();
            setLocalState("verified_balance_kobo", user.verifiedBalanceKobo);
            setLocalState("last_sync_at", new Date().toISOString());
          } catch (err) {
            // If offline at boot, we still proceed to onboarding —
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

        if (keypairPresent && !token) {
          // Returning user, no JWT. Locked state with hasJwt=false; the
          // PIN entry screen unlocks the key for offline use, and the
          // home screen will show "sign in again" for online actions.
          // We don't have a Me object yet — leave it for after unlock,
          // when fetchMe (or stored profile) provides it.
          // Without a Me object the locked screen can still ask for PIN;
          // we synthesize a minimal placeholder.
          if (!isMounted.current) return;
          setState({
            status: "locked",
            user: makePlaceholderMe(),
            hasJwt: false,
          });
          return;
        }

        // keypairPresent && token: try to verify the token freshness
        // and (best effort) refresh the user record. Network errors
        // here must NOT bounce us to unauthed — that's the offline-boot
        // bug fix from 2.1. Treat the token as fresh-enough for now;
        // the freshness check on unlock will re-evaluate.
        // Reachability: the three branches above all return, so we know
        // `token` is non-null here. TS's CFA doesn't carry that across
        // branches, so a runtime guard pacifies the compiler without
        // adding any practical change.
        if (token === null) return;
        let user: Me = makePlaceholderMe();
        try {
          user = await fetchMe();
          setLocalState("verified_balance_kobo", user.verifiedBalanceKobo);
          setLocalState("last_sync_at", new Date().toISOString());
        } catch (err) {
          if (err instanceof NetworkError) {
            logger.info(
              "Offline at boot; treating stored token as valid for now",
            );
          } else {
            // 401 → interceptor will clear the token; propagate to
            // unauthed via the unauthorized handler. Other errors:
            // fall through with placeholder user.
            logger.info("fetchMe during boot failed (non-network)", err);
          }
        }
        if (!isMounted.current) return;
        setState({
          status: "locked",
          user,
          hasJwt: !isJwtExpired(token),
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          }
        }
      },
    );
    return () => {
      sub.remove();
    };
  }, [lock]);

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
  // already on the user object — no free-text email input is shown.
  // Returns the email so the caller can navigate to the OTP verify screen.
  const reauthenticate = useCallback(async (): Promise<string> => {
    const email = (() => {
      const s = state;
      if (
        s.status === "authed" ||
        s.status === "locked" ||
        s.status === "onboarding"
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
      unlock,
      lock,
      signOut,
      reauthenticate,
      getDecryptedPrivateKey,
    }),
    [
      state,
      signIn,
      completeOnboarding,
      unlock,
      lock,
      signOut,
      reauthenticate,
      getDecryptedPrivateKey,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// When the locked screen appears we may not yet have a fresh Me object
// (offline boot). The PIN entry screen doesn't need user fields, but
// the AuthState shape requires one. After successful unlock + a future
// fetchMe call, real fields populate.
function makePlaceholderMe(): Me {
  return {
    id: "u_0000000000000000",
    email: "",
    phone: null,
    role: "STUDENT",
    status: "ACTIVE",
    verifiedBalanceKobo: "0",
    createdAt: new Date(0).toISOString(),
  };
}
