// Minimal theme provider for oneto.
//
// Persists the user's light/dark preference to SecureStore (non-sensitive,
// but SecureStore is already a dependency so no new package needed).
// Defaults to "light" on first launch and on any read error.
//
// Usage:
//   1. Wrap the root layout with <ThemeProvider> (see _layout.tsx comment below).
//   2. Call useThemeMode() in any screen to get { mode, toggleTheme }.
//   3. Pass mode to getTheme(mode) from tokens.ts to get a full theme object.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import * as SecureStore from "expo-secure-store";

const THEME_STORE_KEY = "oneto.ui.themeMode";

export type ThemeMode = "light" | "dark";

interface ThemeContextValue {
  readonly mode: ThemeMode;
  readonly toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "light",
  toggleTheme: () => {},
});

export function ThemeProvider({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  const [mode, setMode] = useState<ThemeMode>("light"); // light is the default

  // Read persisted preference on boot.
  useEffect(() => {
    SecureStore.getItemAsync(THEME_STORE_KEY)
      .then((stored) => {
        if (stored === "dark" || stored === "light") {
          setMode(stored);
        }
        // Any other value (null, corrupt) → keep "light" default.
      })
      .catch(() => {
        // SecureStore unavailable → keep "light" default.
      });
  }, []);

  const toggleTheme = useCallback(() => {
    setMode((prev) => {
      const next: ThemeMode = prev === "light" ? "dark" : "light";
      // Fire-and-forget persist. A failure here just means the preference
      // resets to "light" on next boot — acceptable for a UI preference.
      void SecureStore.setItemAsync(THEME_STORE_KEY, next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeMode(): ThemeContextValue {
  return useContext(ThemeContext);
}
