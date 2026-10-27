// Import API types (M5). See IMPORT.md.

import type { Item, ItemId, ItemKind, SourceInfo } from '../schema/types.ts';

export type ImportKind = ItemKind;

export interface ImportIssue {
  /** CSV: 1-based record number (the header is row 1). JSON: 1-based position in the items array. */
  row?: number;
  id?: string;
  /** Field path within the item (`examples[0].en`) or a column name. */
  path: string;
  msg: string;
  severity: 'error' | 'warning';
}

export interface ImportResult {
  /** Items that passed validation (no error-severity issue), in input order. */
  items: Item[];
  issues: ImportIssue[];
}

export interface ImportContext {
  /** Everything already known (bundle items + custom items), used for refs, ids and diffs. */
  existing: ReadonlyMap<ItemId, Item>;
  /** Source stamped on imported items that do not carry their own. */
  defaultSource: SourceInfo;
  /** Inserted after the kind prefix of generated ids: `v:${idPrefixUser}${word}`. */
  idPrefixUser?: string;
}
