import { getRandomBytesAsync } from "expo-crypto";
import type { PaymentRequest } from "@oneto/shared";

export async function createPaymentRequest(
  merchantId: string,
  amountKobo: number,
  merchantLabel?: string,
): Promise<PaymentRequest> {
  const nonceBytes = await getRandomBytesAsync(16);
  const requestNonce = Array.from(nonceBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return {
    version: 1,
    merchantId,
    amountKobo,
    requestNonce,
    merchantLabel,
    createdAt: new Date().toISOString(),
  };
}
