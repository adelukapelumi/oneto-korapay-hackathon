import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT secret must be at least 32 characters'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_ADDRESS: z.string().optional(),
}).superRefine((data, ctx) => {
  // RESEND_API_KEY is required in production
  if (data.NODE_ENV === 'production' && !data.RESEND_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'RESEND_API_KEY is required in production',
      path: ['RESEND_API_KEY'],
    });
  }
  if (data.NODE_ENV === 'production' && !data.RESEND_FROM_ADDRESS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'RESEND_FROM_ADDRESS is required in production',
      path: ['RESEND_FROM_ADDRESS'],
    });
  }
});

export type EnvSchema = z.infer<typeof envSchema>;
