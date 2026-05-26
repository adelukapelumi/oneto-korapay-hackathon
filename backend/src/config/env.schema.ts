import { z } from 'zod';
import { parseAdminWebOrigins } from '../common/cors';

const baseEnvSchema = z.object({
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT secret must be at least 32 characters'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  OTP_STORE_BACKEND: z.enum(['memory', 'redis']).default('memory'),
  THROTTLER_STORE_BACKEND: z.enum(['memory', 'redis']).default('memory'),
  REDIS_URL: z.string().url().optional(),
  REDIS_KEY_PREFIX: z.string().trim().min(1).optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_ADDRESS: z.string().optional(),
  KORAPAY_PUBLIC_KEY: z.string().optional(),
  KORAPAY_SECRET_KEY: z.string().optional(),
  KORAPAY_BASE_URL: z.string().default('https://api.korapay.com/merchant/api/v1'),
  CASHOUT_PAYOUT_MODE: z.enum(['korapay_api', 'manual']).default('korapay_api'),
  ADMIN_CASHOUT_NOTIFICATION_EMAILS: z.string().optional(),
  ADMIN_WEB_ORIGINS: z.string().optional(),
  ADMIN_OUTBOUND_IP_DIAGNOSTIC_ENABLED: z.enum(["true", "false"]).optional(),
}).superRefine((data, ctx) => {
  const isProduction = data.NODE_ENV === 'production';
  const isRedisEnabled =
    data.OTP_STORE_BACKEND === 'redis' || data.THROTTLER_STORE_BACKEND === 'redis';

  if (isProduction && data.OTP_STORE_BACKEND !== 'redis') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'OTP_STORE_BACKEND must be redis in production',
      path: ['OTP_STORE_BACKEND'],
    });
  }

  if (isProduction && data.THROTTLER_STORE_BACKEND !== 'redis') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'THROTTLER_STORE_BACKEND must be redis in production',
      path: ['THROTTLER_STORE_BACKEND'],
    });
  }

  if (isRedisEnabled && !data.REDIS_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'REDIS_URL is required when Redis storage is enabled',
      path: ['REDIS_URL'],
    });
  }

  if (isProduction && !data.REDIS_KEY_PREFIX) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'REDIS_KEY_PREFIX must be explicitly set in production',
      path: ['REDIS_KEY_PREFIX'],
    });
  }

  if (isProduction && data.REDIS_KEY_PREFIX === 'oneto:dev') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'REDIS_KEY_PREFIX must not be oneto:dev in production',
      path: ['REDIS_KEY_PREFIX'],
    });
  }

  // RESEND_API_KEY is required in production
  if (isProduction && !data.RESEND_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'RESEND_API_KEY is required in production',
      path: ['RESEND_API_KEY'],
    });
  }
  if (isProduction && !data.RESEND_FROM_ADDRESS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'RESEND_FROM_ADDRESS is required in production',
      path: ['RESEND_FROM_ADDRESS'],
    });
  }
  if (isProduction && !data.KORAPAY_PUBLIC_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'KORAPAY_PUBLIC_KEY is required in production',
      path: ['KORAPAY_PUBLIC_KEY'],
    });
  }
  if (isProduction && !data.KORAPAY_SECRET_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'KORAPAY_SECRET_KEY is required in production',
      path: ['KORAPAY_SECRET_KEY'],
    });
  }
  if (data.ADMIN_WEB_ORIGINS) {
    try {
      parseAdminWebOrigins(data.ADMIN_WEB_ORIGINS);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ADMIN_WEB_ORIGINS must be a comma-separated list of valid origins',
        path: ['ADMIN_WEB_ORIGINS'],
      });
    }
  }

  if (data.ADMIN_CASHOUT_NOTIFICATION_EMAILS) {
    for (const rawEmail of data.ADMIN_CASHOUT_NOTIFICATION_EMAILS.split(',')) {
      const candidate = rawEmail.trim();
      if (candidate.length === 0) {
        continue;
      }
      const isValid = z.string().email().safeParse(candidate).success;
      if (!isValid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'ADMIN_CASHOUT_NOTIFICATION_EMAILS must be a comma-separated list of valid email addresses',
          path: ['ADMIN_CASHOUT_NOTIFICATION_EMAILS'],
        });
        break;
      }
    }
  }
});

export const envSchema = baseEnvSchema.transform((data) => ({
  ...data,
  REDIS_KEY_PREFIX: data.REDIS_KEY_PREFIX ?? 'oneto:dev',
}));

export type EnvSchema = z.infer<typeof envSchema>;
