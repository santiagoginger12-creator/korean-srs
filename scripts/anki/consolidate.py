"""Consolidate the master vocab CSV (idempotent):
1. Clean meanings: drop repeated glosses (normalized), keep order, cap at 4.
2. Merge X하다/X되다 into the noun row X when their glosses share a content stem
   (same lexeme family). Counts add, status = least-known, word keeps the noun;
   notes gain 'also: X하다'. Unrelated homograph pairs (전/전하다) stay separate.
3. Link true synonyms in notes ('similar: …') when two words share >= 2 glosses, or
   their whole gloss sets are equal. Rows are never deleted for being synonyms.
"""
import csv, re, sys, collections
src, dst = sys.argv[1], sys.argv[2]
rows = list(csv.DictReader(open(src, encoding='utf-8')))
COLS = list(rows[0].keys())
STOP = {'be', 'to', 'a', 'an', 'the', 'of', 'one', 'something', 'someone', 'sth', 'sb', 'do', 'make', 'get', 'have', 'go', 'thing', 'person', 'in', 'on', 'for', 'with', 'up', 'out', 'off', 'into', 'at', 'by', 'from', 'and', 'or', 'oneself', 'very', 'state', 'act'}
def norm(m): return re.sub(r'\s+', ' ', re.sub(r'^(to|a|an|the) ', '', re.sub(r'\(.*?\)|\[.*?\]', '', m.lower()).strip())).strip(' .')
def raw_glosses(m):
    """Original gloss text, deduplicated by normalized form, order kept."""
    out, seen = [], set()
    for x in (x.strip() for x in re.split(r'[;,/]', m)):
        k = norm(x)
        if x and k and k not in seen: seen.add(k); out.append(x)
    return out
def glosses(m): return [norm(x) for x in raw_glosses(m)]
def stems(m): return {w[:5] for g in glosses(m) for w in re.findall(r'[a-z]+', g) if len(w) >= 4 and w not in STOP}
RANK = {'learning': 0, 'new': 1, 'suspended': 2, 'mastered': 3}
def add_note(r, note):
    parts = [p for p in r['notes'].split(' | ') if p]
    if note not in parts: parts.append(note)
    r['notes'] = ' | '.join(parts)
# 1. clean meanings
for r in rows:
    r['meaning'] = '; '.join(raw_glosses(r['meaning'])[:4]) if r['meaning'] else ''
    r['tags'] = ' '.join(dict.fromkeys(r['tags'].split()))
# 2. merge noun + 하다/되다
by = {r['word']: r for r in rows}
merged = 0; kept_apart = []
for r in list(rows):
    m = re.match(r'^(.+)(하다|되다)$', r['word'])
    if not m or m.group(1) not in by or r['word'] not in by: continue
    noun = by[m.group(1)]
    if 'app' in r['sources'].split():  # app items are keyed by their own headword
        add_note(noun, f"also: {r['word']}"); add_note(r, f"also: {noun['word']}"); continue
    if not (stems(noun['meaning']) & stems(r['meaning'])):
        kept_apart.append((noun['word'], r['word'])); continue
    noun['times_missed'] = str(int(noun['times_missed'] or 0) + int(r['times_missed'] or 0))
    noun['times_seen'] = str(int(noun['times_seen'] or 0) + int(r['times_seen'] or 0))
    noun['last_seen'] = max(noun['last_seen'], r['last_seen'])
    if RANK[r['status']] < RANK[noun['status']]: noun['status'] = r['status']
    if int(noun['times_missed']) >= 8 and noun['status'] != 'suspended': noun['status'] = 'learning'
    vg = [g for g in raw_glosses(r['meaning']) if norm(g) not in glosses(noun['meaning'])][:1]
    if vg: noun['meaning'] = '; '.join(raw_glosses(noun['meaning'])[:3] + [f'{r["word"]}: ' + vg[0]])
    if r['freq_rank'] and (not noun['freq_rank'] or int(r['freq_rank']) < int(noun['freq_rank'])): noun['freq_rank'] = r['freq_rank']
    noun['sources'] = ' '.join(sorted(set(noun['sources'].split()) | set(r['sources'].split())))
    tags = set(noun['tags'].split()) | set(r['tags'].split())
    if int(noun['times_missed']) >= 8: tags.add('leech')
    noun['tags'] = ' '.join(sorted(tags))
    add_note(noun, f"also: {r['word']}")
    rows.remove(r); del by[r['word']]; merged += 1
# 3. synonym links
gs = {r['word']: set(glosses(r['meaning'])) for r in rows}
idx = collections.defaultdict(set)
for w, g in gs.items():
    for x in g: idx[x].add(w)
syn = collections.defaultdict(set)
for w, g in gs.items():
    if not g: continue
    cand = collections.Counter(o for x in g for o in idx[x] if o != w)
    for o, n in cand.items():
        same_kind = w.endswith('다') == o.endswith('다')
        if same_kind and (n >= 2 or gs[o] == g): syn[w].add(o)
linked = 0
for r in rows:
    s = sorted(syn.get(r['word'], ()), key=lambda o: int(by[o]['freq_rank'] or 99999))[:5]
    r['notes'] = ' | '.join(p for p in r['notes'].split(' | ') if p and not p.startswith('similar: '))
    if s: add_note(r, 'similar: ' + ', '.join(s)); linked += 1
order = {'learning': 0, 'new': 1, 'mastered': 2, 'suspended': 3}
rows.sort(key=lambda r: (order[r['status']], -int(r['times_missed'] or 0), r['word']))
with open(dst, 'w', newline='', encoding='utf-8') as fh:
    w = csv.DictWriter(fh, fieldnames=COLS, lineterminator='\r\n'); w.writeheader(); w.writerows(rows)
print(f'rows {len(rows)} | merged 하다/되다 pairs {merged} | homograph pairs kept apart {len(kept_apart)} e.g. {kept_apart[:8]} | rows with synonym links {linked}')
print(collections.Counter(r['status'] for r in rows))
