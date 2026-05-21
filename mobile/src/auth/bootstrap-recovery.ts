import { ApiError } from "../api/errors";

export function isUserNotFoundError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.message === "user_not_found" ||
      err.code === "user_not_found" ||
      err.status === 404)
  );
}

export async function resetLocalAuthAfterMissingUser({
  clearTokenFn,
  clearAttemptsFn,
  wipeKeypairFn,
  wipeInMemoryKeyFn,
}: {
  readonly clearTokenFn: () => Promise<void>;
  readonly clearAttemptsFn: () => Promise<void>;
  readonly wipeKeypairFn: () => Promise<void>;
  readonly wipeInMemoryKeyFn: () => void;
}): Promise<void> {
  await clearTokenFn();
  await clearAttemptsFn();
  await wipeKeypairFn();
  wipeInMemoryKeyFn();
}
