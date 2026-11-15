/**
 * "Shown once" secrets (API keys, webhook signing secrets). The full value lives only in component state for the
 * moment it's revealed; once dismissed it's gone and only the prefix remains. Pure helpers, unit tested.
 */
export interface RevealState {
  secret: string | null;
  acknowledged: boolean;
}

export const EMPTY_REVEAL: RevealState = { secret: null, acknowledged: false };

export function reveal(secret: string): RevealState {
  return { secret, acknowledged: false };
}

/** Closing wipes the secret. There's no way to get it back. */
export function dismiss(): RevealState {
  return { secret: null, acknowledged: true };
}

/** "mc_test_sk_AbCd…" style mask for a stored key prefix. */
export function maskKey(prefix: string): string {
  return `${prefix}${"•".repeat(8)}`;
}
