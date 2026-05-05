import { decodeJwt, isJwtExpired } from "./jwt-decode";

function b64url(s: string): string {
  // Node's Buffer base64 → strip padding and replace +/ with -_.
  return Buffer.from(s)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function makeJwt(payload: object): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  // Signature is irrelevant — decodeJwt does not verify.
  return `${header}.${body}.fake-signature`;
}

const validPayload = {
  sub: "u_0123456789abcdef",
  email: "test@example.com",
  role: "STUDENT" as const,
  pubKeyRegistered: false,
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
};

describe("decodeJwt", () => {
  it("decodes a well-formed JWT payload", () => {
    const token = makeJwt(validPayload);
    expect(decodeJwt(token)).toEqual(validPayload);
  });

  it("returns null for a token missing the body part", () => {
    expect(decodeJwt("only.two")).toBeNull();
    expect(decodeJwt("just-one-part")).toBeNull();
  });

  it("returns null for a body that isn't valid base64", () => {
    expect(decodeJwt("aaa.!!!.bbb")).toBeNull();
  });

  it("returns null when payload is missing required fields", () => {
    const incomplete = makeJwt({ sub: "x", email: "y" });
    expect(decodeJwt(incomplete)).toBeNull();
  });

  it("returns null for an unknown role value", () => {
    const bad = makeJwt({ ...validPayload, role: "SUPERUSER" });
    expect(decodeJwt(bad)).toBeNull();
  });

  it("decodes pubKeyRegistered=true", () => {
    const token = makeJwt({ ...validPayload, pubKeyRegistered: true });
    const out = decodeJwt(token);
    expect(out?.pubKeyRegistered).toBe(true);
  });
});

describe("isJwtExpired", () => {
  it("returns false for a token expiring in the future (beyond skew)", () => {
    const token = makeJwt({
      ...validPayload,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(isJwtExpired(token)).toBe(false);
  });

  it("returns true for a token already past exp", () => {
    const token = makeJwt({
      ...validPayload,
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    expect(isJwtExpired(token)).toBe(true);
  });

  it("returns true for a token within the 30s skew window", () => {
    // exp - 30 <= now means expired. exp = now + 15 → now + 15 - 30 = now - 15 → expired.
    const token = makeJwt({
      ...validPayload,
      exp: Math.floor(Date.now() / 1000) + 15,
    });
    expect(isJwtExpired(token)).toBe(true);
  });

  it("returns true for a malformed token", () => {
    expect(isJwtExpired("not-a-jwt")).toBe(true);
  });

  it("respects the injected nowMs argument", () => {
    const exp = 2_000_000;
    const token = makeJwt({ ...validPayload, exp, iat: exp - 3600 });
    // 1h before exp → fresh
    expect(isJwtExpired(token, (exp - 3600) * 1000)).toBe(false);
    // exact exp → expired
    expect(isJwtExpired(token, exp * 1000)).toBe(true);
  });
});
