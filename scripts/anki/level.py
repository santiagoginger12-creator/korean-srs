import json, sys, glob, collections, re
d = sys.argv[1]; seed = sys.argv[2]
W = json.load(open(f'{d}/anki_words.json'))
by = {w['word']: w for w in W}
known = lambda w: w['status'] == 'mature'
seen = lambda w: w['status'] in ('mature', 'young', 'learning', 'suspended')
def bands(key, size, top):
    print(f'\n{key} (band size {size})  words | studied% | mature% | avg lapses (studied)')
    for lo in range(1, top, size):
        ws = [w for w in W if w.get(key) and lo <= w[key] < lo + size]
        if not ws: continue
        st = [w for w in ws if seen(w)]
        print(f'  {lo:>5}-{lo+size-1:<5} {len(ws):>5} | {100*len(st)/len(ws):5.1f}% | {100*sum(map(known, ws))/len(ws):5.1f}% | {sum(w["lapses"] for w in st)/max(1,len(st)):.1f}')
bands('rank11k', 1000, 12000); bands('rankCore', 1000, 6000); bands('rankEvita', 1000, 7000)
# app seed overlap
items = [i for f in sorted(glob.glob(f'{seed}/L0*/vocab.json')) for i in json.load(open(f))]
def look(word):
    if word in by: return by[word]
    base = re.sub(r'(하다|되다|스럽다|롭다)$', '', word)
    return by.get(base)
ov = collections.Counter(); rows = []
for it in items:
    w = look(it['word']); st = w['status'] if w else 'not in Anki'
    ov[st] += 1; rows.append((it['level'], it['word'], st, w['lapses'] if w else ''))
print('\nApp seed vocab (120) vs Anki:', dict(ov))
print('  mature in Anki:', [r[1] for r in rows if r[2] == 'mature'])
# leeches
lee = sorted([w for w in W if seen(w)], key=lambda w: -w['lapses'])[:40]
print('\nTop leeches:', [(w['word'], w['lapses'], w['status']) for w in lee])
lapses = [w['lapses'] for w in W if seen(w)]
print('studied words with >=5 lapses:', sum(l >= 5 for l in lapses), ' >=8:', sum(l >= 8 for l in lapses), 'of', len(lapses))
# hanja leverage
hz = collections.defaultdict(lambda: {'mature': 0, 'unknown': []})
for w in W:
    for ch in re.findall(r'[一-鿿]', w['hanja'] or ''):
        if known(w): hz[ch]['mature'] += 1
        elif w['status'] == 'new': hz[ch]['unknown'].append(w['word'])
lev = sorted(hz.items(), key=lambda kv: -len(kv[1]['unknown']))[:25]
print('\nHanja with most UNSTUDIED words (char, mature words, unstudied count, examples):')
for ch, v in lev: print(' ', ch, v['mature'], len(v['unknown']), v['unknown'][:6])
seedh = {i['char'] for f in glob.glob(f'{seed}/L0*/hanja.json') for i in json.load(open(f))}
print('\nApp seed hanja:', ''.join(sorted(seedh)))
print('mature Anki words per seed hanja:', {h: hz[h]['mature'] if h in hz else 0 for h in sorted(seedh)})
