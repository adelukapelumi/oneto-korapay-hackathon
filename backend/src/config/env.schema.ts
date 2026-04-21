import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT secret must be at least 32 characters'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type EnvSchema = z.infer<typeof envSchema>;
