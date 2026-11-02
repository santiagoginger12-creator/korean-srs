// UTF-8 ⇄ base64 for the GitHub contents API. Plain TS (no Buffer, no btoa) so it behaves the
// same in browsers and Node. GitHub wraps base64 at 60 columns; whitespace is ignored on decode.

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const REV = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHA.length; i++) REV[ALPHA.charCodeAt(i)] = i;

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHA[n >> 18]! + ALPHA[(n >> 12) & 63]! + ALPHA[(n >> 6) & 63]! + ALPHA[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += ALPHA[n >> 18]! + ALPHA[(n >> 12) & 63]! + '==';
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHA[n >> 18]! + ALPHA[(n >> 12) & 63]! + ALPHA[(n >> 6) & 63]! + '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[\s=]+/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i);
    const v = c < 128 ? REV[c]! : -1;
    if (v < 0) throw new Error('invalid base64');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
  }
  return out.subarray(0, o);
}

export const utf8ToBase64 = (s: string): string => bytesToBase64(new TextEncoder().encode(s));
export const base64ToUtf8 = (b64: string): string => new TextDecoder('utf-8', { fatal: false }).decode(base64ToBytes(b64));

/** 40 hex chars, content-addressed like a git blob sha (not the real SHA-1; fakes only). */
export function fakeBlobSha(content: string): string {
  const data = `blob ${content.length}\0${content}`;
  let out = '';
  for (let k = 0; k < 5; k++) {
    let h = (0x811c9dc5 ^ (k * 0x9e3779b1)) >>> 0;
    for (let i = 0; i < data.length; i++) { h ^= data.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    out += h.toString(16).padStart(8, '0');
  }
  return out;
}
