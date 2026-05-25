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

// Cashout safety limits
// Pilot minimum gross merchant cashout request: NGN 1,000
export const MIN_CASHOUT_GROSS_KOBO = 100_000;
// Minimum amount safe to send to payout gateway after fees: NGN 500
export const MIN_KORAPAY_TRANSFER_KOBO = 50_000;

// Envelope timing
// Short QR scan/display freshness window.
// This is not the offline merchant claim window.
export const ENVELOPE_TTL_SECONDS = 300;
export const CLOCK_SKEW_TOLERANCE_SECONDS = 120; // accept timestamps up to 2 min in future

// Backend derives the settlement claim deadline from the signed envelope
// timestamp plus this fixed window. Mobile may display the same deadline,
// but the backend remains the authority for settlement decisions.
export const OFFLINE_CLAIM_WINDOW_HOURS = 48;

// Sequence number starting value
export const INITIAL_SEQUENCE_NUMBER = 1;
