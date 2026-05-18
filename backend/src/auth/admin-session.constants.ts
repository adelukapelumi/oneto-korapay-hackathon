import { CookieOptions } from "express";

export const ADMIN_SESSION_COOKIE_NAME = "oneto_admin_session";
export const ADMIN_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
export const ADMIN_SESSION_MAX_AGE_SECONDS = ADMIN_SESSION_MAX_AGE_MS / 1000;

function isProduction(nodeEnv: string): boolean {
  return nodeEnv === "production";
}

export function buildAdminSessionCookieOptions(nodeEnv: string): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction(nodeEnv),
    sameSite: "strict",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_MS,
  };
}

export function buildAdminSessionClearCookieOptions(
  nodeEnv: string,
): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction(nodeEnv),
    sameSite: "strict",
    path: "/",
  };
}
