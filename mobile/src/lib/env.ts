import { z } from "zod";

// EXPO_PUBLIC_* values are inlined at bundle time. Validating at module load
// gives us a loud crash on misconfiguration instead of a confusing 404 later.
//
// Gotcha: changing .env requires a Metro restart. Without --clear, Metro will
// keep serving the old bundle that still has the old EXPO_PUBLIC_* values
// inlined.
const EnvSchema = z.object({
  EXPO_PUBLIC_API_URL: z
    .string({ required_error: "EXPO_PUBLIC_API_URL is required" })
    .url("EXPO_PUBLIC_API_URL must be a valid URL")
    .refine(
      (u) => u.startsWith("https://"),
      "EXPO_PUBLIC_API_URL must use https",
    )
    .refine(
      (u) => !u.endsWith("/"),
      "EXPO_PUBLIC_API_URL must not end with a trailing slash",
    ),
});

export type Env = {
  readonly API_URL: string;
};

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse({
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration. Check mobile/.env:\n${issues}`,
    );
  }
  return { API_URL: parsed.data.EXPO_PUBLIC_API_URL };
}

export const env: Env = loadEnv();

export const __test__ = { EnvSchema, loadEnv };
