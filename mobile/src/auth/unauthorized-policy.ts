export interface UnauthorizedTokenPolicyInput {
  readonly pendingRecoveryKeypairPresent: boolean;
}

export function shouldClearTokenAfterUnauthorized({
  pendingRecoveryKeypairPresent,
}: UnauthorizedTokenPolicyInput): boolean {
  return !pendingRecoveryKeypairPresent;
}
