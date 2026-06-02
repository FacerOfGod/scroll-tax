// Pure helpers for splitting an XRP penalty among group members without losing
// "dust". All math is done in integer drops (1 XRP = 1,000,000 drops) so floating
// -point rounding can never make the distributed total drift from the amount
// charged. The flooring remainder is routed to the first recipient, mirroring the
// server-side token split in migration 20260602000000_penalty_dust_fix.sql.

export const DROPS_PER_XRP = 1_000_000;

/** Convert an XRP amount to whole drops (nearest drop). */
export function xrpToDropsInt(xrp: number): number {
  return Math.round(xrp * DROPS_PER_XRP);
}

/** Convert whole drops to a 6-decimal XRP string suitable for an XRPL Payment. */
export function dropsToXrpString(drops: number): string {
  return (drops / DROPS_PER_XRP).toFixed(6);
}

/**
 * Split `totalDrops` across `recipientCount` recipients. Every recipient gets the
 * floored equal share; the first recipient additionally receives the remainder so
 * the returned amounts always sum back to exactly `totalDrops` — no drops vanish.
 *
 * Returns an empty array for a non-positive recipient count. Individual entries may
 * be 0 when the total is smaller than the recipient count; callers must skip
 * zero-amount transfers since XRPL rejects 0-drop Payments.
 */
export function splitDrops(totalDrops: number, recipientCount: number): number[] {
  if (recipientCount <= 0) return [];
  const base = Math.floor(totalDrops / recipientCount);
  const remainder = totalDrops - base * recipientCount;
  return Array.from(
    { length: recipientCount },
    (_, i) => base + (i === 0 ? remainder : 0),
  );
}
