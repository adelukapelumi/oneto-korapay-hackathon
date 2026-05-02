import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchMe, type Me } from "../api/auth";
import { setUnauthorizedHandler } from "../api/client";
import { logger } from "../lib/logger";
import { clearToken, getToken, setToken } from "./token-store";
import { AuthContext, type AuthState, type AuthStatus } from "./auth-state";

interface ProviderProps {
  readonly children: React.ReactNode;
}

export function AuthProvider({ children }: ProviderProps): React.ReactElement {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<Me | null>(null);
  const isMounted = useRef(true);

  const signOut = useCallback(async () => {
    await clearToken();
    if (!isMounted.current) return;
    setUser(null);
    setStatus("unauthed");
  }, []);

  const signIn = useCallback(async (token: string, nextUser: Me) => {
    await setToken(token);
    if (!isMounted.current) return;
    setUser(nextUser);
    setStatus("authed");
  }, []);

  // Bootstrap: read any persisted token, validate it via GET /me. The 401
  // interceptor clears the token automatically if it's stale, so we don't
  // need to handle that case here — fetchMe will reject and we'll fall to
  // unauthed below.
  useEffect(() => {
    isMounted.current = true;

    setUnauthorizedHandler(() => {
      if (!isMounted.current) return;
      setUser(null);
      setStatus("unauthed");
    });

    void (async () => {
      try {
        const token = await getToken();
        if (!token) {
          if (!isMounted.current) return;
          setStatus("unauthed");
          return;
        }
        const me = await fetchMe();
        if (!isMounted.current) return;
        setUser(me);
        setStatus("authed");
      } catch (err) {
        logger.info("Auth bootstrap failed; treating as signed out", err);
        if (!isMounted.current) return;
        setUser(null);
        setStatus("unauthed");
      }
    })();

    return () => {
      isMounted.current = false;
      setUnauthorizedHandler(null);
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({ status, user, signIn, signOut }),
    [status, user, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
