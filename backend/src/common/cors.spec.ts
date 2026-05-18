import { buildAllowedCorsOrigins, parseAdminWebOrigins } from './cors';

describe('parseAdminWebOrigins', () => {
  it('returns an empty list when env var is missing', () => {
    expect(parseAdminWebOrigins(undefined)).toEqual([]);
  });

  it('parses comma-separated origins and removes duplicates', () => {
    const result = parseAdminWebOrigins(
      'https://admin.getoneto.com, https://staging-admin.getoneto.com, https://admin.getoneto.com',
    );

    expect(result).toEqual([
      'https://admin.getoneto.com',
      'https://staging-admin.getoneto.com',
    ]);
  });

  it('normalizes trailing slash and path segments to origin only', () => {
    const result = parseAdminWebOrigins('https://admin.getoneto.com/dashboard/');

    expect(result).toEqual(['https://admin.getoneto.com']);
  });

  it('throws for invalid origin input', () => {
    expect(() => parseAdminWebOrigins('not-a-url')).toThrow();
  });
});

describe('buildAllowedCorsOrigins', () => {
  it('always includes local admin-web development origins', () => {
    const result = buildAllowedCorsOrigins();

    expect(result).toEqual(
      expect.arrayContaining([
        'http://localhost:4173',
        'http://127.0.0.1:4173',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
      ]),
    );
  });

  it('includes origins from ADMIN_WEB_ORIGINS', () => {
    const result = buildAllowedCorsOrigins('https://admin.getoneto.com');

    expect(result).toContain('https://admin.getoneto.com');
  });
});
