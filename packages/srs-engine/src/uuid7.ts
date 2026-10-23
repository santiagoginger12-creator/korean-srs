// UUIDv7 (RFC 9562) with injected clock and RNG: 48-bit unix ms, version 7, 74 random bits.

export function uuidv7(clock: () => number, rng: () => number): string {
  const ms = Math.max(0, Math.floor(clock()));
  const bytes = new Array<number>(16);
  // 48-bit big-endian timestamp (2^48 ms ≈ year 10889).
  let t = ms;
  for (let i = 5; i >= 0; i--) { bytes[i] = t % 256; t = Math.floor(t / 256); }
  for (let i = 6; i < 16; i++) bytes[i] = Math.floor(rng() * 256) & 0xff;
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
