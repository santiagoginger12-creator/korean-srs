// Seed items → ContentBundle (ARCHITECTURE.md §9.3). Pure: hashing and canonical JSON are
// injected (bin/ wires in srs-engine's sha256Hex/canonicalJson; content/src may not import them).

import type { ContentBundle, Item, ItemId } from './schema/types.ts';

export interface BundleDeps {
  /** Canonical JSON: recursively sorted keys, no whitespace, undefined members omitted. */
  canonicalJson: (v: unknown) => string;
  /** Lowercase hex SHA-256 of the UTF-8 encoding of a string. */
  sha256Hex: (s: string) => string;
}

/**
 * Item order is preserved (it is "content order" for lessons, §7.3).
 * contentVersion = sha256(canonicalJson({ formatVersion, items, idRedirects })).
 */
export function buildBundle(items: readonly Item[], idRedirects: Record<ItemId, ItemId>, deps: BundleDeps): ContentBundle {
  const redirects: Record<ItemId, ItemId> = {};
  for (const k of Object.keys(idRedirects).sort()) redirects[k] = idRedirects[k]!;
  const body = { formatVersion: 1 as const, items: [...items], idRedirects: redirects };
  const contentVersion = deps.sha256Hex(deps.canonicalJson(body));
  return { formatVersion: 1, contentVersion, items: body.items, idRedirects: redirects };
}
