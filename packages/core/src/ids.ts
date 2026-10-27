/**
 * Record identifiers.
 *
 * Every `id` column holds a UUID. New ids are UUID v7 (RFC 9562): the leading 48 bits
 * are the creation time in Unix milliseconds, so ids sort by creation time and new rows
 * land at the end of the primary-key index instead of scattering across it.
 */

/** Lowercase canonical form, RFC 9562 versions 1-8 with the `10` variant. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * A new UUID v7, lowercase and hyphenated. Ids made in different milliseconds sort
 * lexicographically by time; ids made within the same millisecond are in random order.
 */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const ms = Date.now();
  // 48-bit big-endian timestamp. Division, not shifts: bitwise ops truncate to 32 bits.
  for (let i = 0; i < 6; i++) {
    bytes[i] = Math.floor(ms / 2 ** (8 * (5 - i))) % 256;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * True for a UUID in canonical storage form: lowercase, hyphenated, RFC 9562 variant,
 * any version 1-8 (imported records may carry v4 ids). Uppercase is rejected so that the
 * same id can never be stored under two spellings. The nil and max UUIDs are rejected.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
