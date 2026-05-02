// __DEV__ is a global injected by React Native's Metro bundler. It is `true`
// in dev builds and `false` in production. The logger no-ops in production
// so we never accidentally ship console output that could leak request URLs,
// emails, or other PII to a debug console.
//
// Use this everywhere instead of `console.log`. The lint expectation is that
// no committed code calls `console.*` directly.

declare const __DEV__: boolean;

type LogFn = (message: string, ...args: unknown[]) => void;

const noop: LogFn = () => undefined;

function devLog(level: "debug" | "info" | "warn" | "error"): LogFn {
  if (typeof __DEV__ !== "undefined" && !__DEV__) {
    return noop;
  }
  return (message, ...args) => {
    // eslint-disable-next-line no-console
    console[level](`[oneto] ${message}`, ...args);
  };
}

export const logger = {
  debug: devLog("debug"),
  info: devLog("info"),
  warn: devLog("warn"),
  error: devLog("error"),
};
