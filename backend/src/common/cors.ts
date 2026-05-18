// Local admin-web development origins (exact match only).
const LOCAL_ADMIN_WEB_DEV_ORIGINS = [
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
] as const;

function normalizeOrigin(origin: string): string {
  return new URL(origin).origin;
}

export function parseAdminWebOrigins(originsCsv?: string): string[] {
  if (!originsCsv || originsCsv.trim().length === 0) {
    return [];
  }

  const parsed = new Set<string>();

  for (const rawOrigin of originsCsv.split(',')) {
    const candidate = rawOrigin.trim();
    if (!candidate) {
      continue;
    }

    parsed.add(normalizeOrigin(candidate));
  }

  return Array.from(parsed);
}

export function buildAllowedCorsOrigins(originsCsv?: string): string[] {
  const allowedOrigins = new Set<string>(LOCAL_ADMIN_WEB_DEV_ORIGINS);

  for (const envOrigin of parseAdminWebOrigins(originsCsv)) {
    allowedOrigins.add(envOrigin);
  }

  return Array.from(allowedOrigins);
}
