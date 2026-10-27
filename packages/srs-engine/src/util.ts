// Small pure helpers shared across the engine: time constants, hashing, seeded PRNG,
// canonical JSON and a dependency-free SHA-256 (used for backup checksums).

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/** Round down to the UTC epoch hour. Deterministic across devices (see §7.1). */
export function floorHour(t: number): number {
  return Math.floor(t / HOUR) * HOUR;
}

/** 32-bit FNV-1a over UTF-16 code units. Stable, fast, non-cryptographic. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG: returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher–Yates shuffle keyed by a string seed. Returns a new array. */
export function seededShuffle<T>(arr: readonly T[], seed: string): T[] {
  const out = arr.slice();
  const rnd = mulberry32(fnv1a(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** JSON with recursively sorted object keys, no whitespace, `undefined` members omitted. */
export function canonicalJson(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  switch (typeof v) {
    case 'number':
      return Number.isFinite(v) ? JSON.stringify(v) : 'null';
    case 'boolean':
      return v ? 'true' : 'false';
    case 'string':
      return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) return '[' + v.map((x) => canonicalJson(x)).join(',') + ']';
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(o[k])).join(',') + '}';
    }
    default:
      return 'null';
  }
}

/** UTF-8 bytes of `s` in a zeroed buffer with room for the SHA-256 padding (typed arrays keep 50k-event backups fast). */
function utf8Padded(s: string): { bytes: Uint8Array; len: number } {
  const cap = s.length * 3 + 72;
  const out = new Uint8Array(cap - (cap % 64) + 64);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      } else c = 0xfffd;
    } else if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out[n++] = c;
    else if (c < 0x800) { out[n++] = 0xc0 | (c >> 6); out[n++] = 0x80 | (c & 63); }
    else if (c < 0x10000) { out[n++] = 0xe0 | (c >> 12); out[n++] = 0x80 | ((c >> 6) & 63); out[n++] = 0x80 | (c & 63); }
    else { out[n++] = 0xf0 | (c >> 18); out[n++] = 0x80 | ((c >> 12) & 63); out[n++] = 0x80 | ((c >> 6) & 63); out[n++] = 0x80 | (c & 63); }
  }
  return { bytes: out, len: n };
}

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of the UTF-8 encoding of `s`, as lowercase hex. */
export function sha256Hex(s: string): string {
  const { bytes, len } = utf8Padded(s);
  const bitLen = len * 8;
  let total = len + 1;
  while (total % 64 !== 56) total++;
  total += 8;
  bytes[len] = 0x80; // the rest of the padding is already zero
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  bytes[total - 8] = (hi >>> 24) & 255; bytes[total - 7] = (hi >>> 16) & 255; bytes[total - 6] = (hi >>> 8) & 255; bytes[total - 5] = hi & 255;
  bytes[total - 4] = (lo >>> 24) & 255; bytes[total - 3] = (lo >>> 16) & 255; bytes[total - 2] = (lo >>> 8) & 255; bytes[total - 1] = lo & 255;
  // int32 arithmetic throughout (|0) keeps V8 on its fast integer paths.
  const H = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Int32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      W[i] = (bytes[j]! << 24) | (bytes[j + 1]! << 16) | (bytes[j + 2]! << 8) | bytes[j + 3]!;
    }
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15]!, w2 = W[i - 2]!;
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) | 0;
    }
    let a = H[0]!, b = H[1]!, c = H[2]!, d = H[3]!, e = H[4]!, f = H[5]!, g = H[6]!, h = H[7]!;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i]! + W[i]!) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0]! + a) | 0; H[1] = (H[1]! + b) | 0; H[2] = (H[2]! + c) | 0; H[3] = (H[3]! + d) | 0;
    H[4] = (H[4]! + e) | 0; H[5] = (H[5]! + f) | 0; H[6] = (H[6]! + g) | 0; H[7] = (H[7]! + h) | 0;
  }
  return Array.from(H, (x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
