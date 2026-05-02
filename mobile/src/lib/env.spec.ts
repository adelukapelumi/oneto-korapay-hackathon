import { __test__ } from "./env";

const { EnvSchema } = __test__;

describe("EnvSchema", () => {
  it("accepts a well-formed https URL", () => {
    const r = EnvSchema.safeParse({
      EXPO_PUBLIC_API_URL: "https://oneto-production.up.railway.app",
    });
    expect(r.success).toBe(true);
  });

  it("rejects http URLs", () => {
    const r = EnvSchema.safeParse({ EXPO_PUBLIC_API_URL: "http://example.com" });
    expect(r.success).toBe(false);
  });

  it("rejects URLs with a trailing slash", () => {
    const r = EnvSchema.safeParse({
      EXPO_PUBLIC_API_URL: "https://example.com/",
    });
    expect(r.success).toBe(false);
  });

  it("rejects undefined", () => {
    const r = EnvSchema.safeParse({ EXPO_PUBLIC_API_URL: undefined });
    expect(r.success).toBe(false);
  });

  it("rejects empty string", () => {
    const r = EnvSchema.safeParse({ EXPO_PUBLIC_API_URL: "" });
    expect(r.success).toBe(false);
  });

  it("rejects non-URL strings", () => {
    const r = EnvSchema.safeParse({ EXPO_PUBLIC_API_URL: "not-a-url" });
    expect(r.success).toBe(false);
  });

  it("rejects ftp", () => {
    const r = EnvSchema.safeParse({
      EXPO_PUBLIC_API_URL: "ftp://example.com",
    });
    expect(r.success).toBe(false);
  });
});
