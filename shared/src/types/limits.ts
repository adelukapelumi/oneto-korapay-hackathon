/**
 * System-wide limits.
 *
 * Changing these values requires a coordinated migration between
 * mobile and backend. Do not change one without the other.
 */

// Max amount per offline transaction: ₦2,000 = 200,000 kobo
export const MAX_OFFLINE_TRANSACTION_KOBO = 200_000;

// Max total balance a single user can hold: ₦50,000 = 5,000,000 kobo
// (Pilot cap; revisit after pilot.)
export const MAX_USER_BALANCE_KOBO = 5_000_000;

// Envelope timing
export const ENVELOPE_TTL_SECONDS = 60; // envelope expires 60s after signing
export const CLOCK_SKEW_TOLERANCE_SECONDS = 120; // accept timestamps up to 2 min in future

// Sequence number starting value
export const INITIAL_SEQUENCE_NUMBER = 1;