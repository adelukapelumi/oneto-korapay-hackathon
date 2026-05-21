import { EnvelopeDraftSchema } from "@oneto/shared";
import { generateOnetoUserId } from "./user-id";

function makeDraftWithIds(senderUserId: string, recipientUserId: string) {
  const now = Date.now();

  return {
    version: 1 as const,
    senderUserId,
    senderPublicKey: `ed25519:${"a".repeat(64)}`,
    recipientUserId,
    amountKobo: 50_000,
    senderSequenceNumber: 1,
    senderBalanceBeforeKobo: 200_000,
    senderBalanceAfterKobo: 150_000,
    timestamp: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    requestNonce: "0".repeat(32),
  };
}

describe("generateOnetoUserId", () => {
  it("returns the canonical oneto user ID format", () => {
    expect(generateOnetoUserId()).toMatch(/^u_[0-9a-f]{16}$/);
  });

  it("produces lowercase hex IDs that the shared envelope schema accepts", () => {
    const senderUserId = generateOnetoUserId();
    let recipientUserId = generateOnetoUserId();

    while (recipientUserId === senderUserId) {
      recipientUserId = generateOnetoUserId();
    }

    const result = EnvelopeDraftSchema.safeParse(
      makeDraftWithIds(senderUserId, recipientUserId),
    );

    expect(result.success).toBe(true);
  });

  it("does not produce the legacy Prisma CUID prefix", () => {
    expect(generateOnetoUserId().startsWith("cm")).toBe(false);
  });
});
