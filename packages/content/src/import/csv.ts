// RFC 4180 CSV reader/writer plus the escape-aware splitting used inside multi-value cells
// (IMPORT.md). Pure and total: never throws.

/**
 * Parses CSV text into rows of fields. Handles a leading BOM, quoted fields with `""` escapes,
 * embedded delimiters/newlines inside quotes, and CRLF / LF / CR line endings. Tolerant of
 * sloppy input: a quote inside an unquoted field is literal, and an unterminated quoted field
 * runs to the end of the text. A trailing line break does not produce an extra empty row.
 */
export function parseCsv(text: string, opts: { delimiter?: string } = {}): string[][] {
  const d = opts.delimiter && opts.delimiter.length === 1 ? opts.delimiter : ',';
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  const n = s.length;
  let quoted = false;     // current field started with a quote
  let fieldStarted = false;

  const endField = () => { row.push(field); field = ''; quoted = false; fieldStarted = false; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < n) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; // closing quote; anything until the delimiter is appended literally
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && !fieldStarted) { quoted = true; fieldStarted = true; i++; continue; }
    if (ch === d) { endField(); i++; continue; }
    if (ch === '\r' || ch === '\n') {
      endRow();
      i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch;
    fieldStarted = true;
    i++;
  }
  // Last record (no trailing newline), unless the text ended exactly at a line break.
  if (fieldStarted || field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * Guesses the delimiter from the header line: `,` when it has any (outside quotes), otherwise
 * `;` (Excel in locales with a decimal comma) or a tab (copied from a spreadsheet), whichever
 * occurs more. Blank lines and `#` comment lines are skipped.
 */
export function sniffDelimiter(text: string): ',' | ';' | '\t' {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (const line of s.split(/\r\n|\n|\r/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const bare = line.replace(/"(?:[^"]|"")*"?/g, '');
    const n = (c: string) => bare.split(c).length - 1;
    if (n(',') > 0) return ',';
    const semi = n(';');
    const tab = n('\t');
    return semi === 0 && tab === 0 ? ',' : semi >= tab ? ';' : '\t';
  }
  return ',';
}

/** Serializes rows as RFC 4180 CSV with CRLF line endings (no BOM; see exportCsv). */
export function toCsv(rows: readonly (readonly string[])[], opts: { delimiter?: string } = {}): string {
  const d = opts.delimiter && opts.delimiter.length === 1 ? opts.delimiter : ',';
  const needs = (v: string) => v.includes(d) || /["\r\n]/.test(v) || /^\s|\s$/.test(v);
  return rows.map((r) => r.map((v) => (needs(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(d)).join('\r\n') + (rows.length ? '\r\n' : '');
}

// ---------------------------------------------------------------------------
// Multi-value cells: `a|b|c`, pairs `ko::en`, hanja `결:決`. A backslash escapes the next
// character (`\|`, `\:`, `\\`). Splitting keeps escapes so nested splits stay correct;
// `unesc` removes them at the leaf.

/** Splits on unescaped `sep`; with `limit`, the last part keeps the rest (escapes intact). */
export function splitEsc(s: string, sep: string, limit = Infinity): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '\\' && i + 1 < s.length) { cur += ch + s[i + 1]; i++; continue; }
    if (out.length < limit - 1 && s.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function unesc(s: string): string {
  return s.replace(/\\(.)/gs, '$1');
}

/** Escapes a value for a `|` list. */
export function escList(v: string): string {
  return v.replace(/[\\|]/g, (m) => '\\' + m);
}

/** Escapes a value for a `::` pair inside a `|` list: colons only where they could be misread. */
export function escPair(v: string): string {
  let out = '';
  for (let i = 0; i < v.length; i++) {
    const ch = v[i]!;
    if (ch === '\\' || ch === '|') out += '\\' + ch;
    else if (ch === ':' && (i === 0 || i === v.length - 1 || v[i - 1] === ':' || v[i + 1] === ':')) out += '\\:';
    else out += ch;
  }
  return out;
}

/** Escapes every colon (fields split on a single `:`). */
export function escColon(v: string): string {
  return v.replace(/[\\|:]/g, (m) => '\\' + m);
}

/** `a|b|c` → ['a','b','c'] (trimmed, empties dropped). */
export function splitList(cell: string): string[] {
  if (!cell.trim()) return [];
  return splitEsc(cell, '|').map((x) => unesc(x.trim())).filter((x) => x !== '');
}
