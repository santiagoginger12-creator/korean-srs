import json, csv, sys, glob, re
words = json.load(open(sys.argv[1])); seed = sys.argv[2]; out_csv = sys.argv[3]; out_import = sys.argv[4]
COLS = ['word','meaning','hanja','pos','status','times_missed','times_seen','last_seen','freq_rank','sources','tags','notes']
rows = {}
def status(w):
    if w['status'] == 'suspended': return 'suspended'
    if w['status'] in ('young', 'learning') or w['lapses'] >= 8: return 'learning'
    if w['status'] == 'mature': return 'mastered'
    return 'new'
for w in words:
    if w['status'] == 'new': continue  # never drilled: kept out of the master list (see VOCAB_PROFILE)
    rank = w.get('rank11k') or w.get('rankEvita') or w.get('rankCore') or ''
    tags = []
    if w['lapses'] >= 8: tags.append('leech')
    if w['status'] in ('young', 'learning'): tags.append('shaky')
    rows[w['word']] = {'word': w['word'], 'meaning': w['meaning'], 'hanja': re.sub(r'[^一-鿿-]', '', w['hanja'] or ''),
        'pos': 'verb/adj' if w['word'].endswith('다') else '', 'status': status(w), 'times_missed': w['lapses'], 'times_seen': w['reps'],
        'last_seen': w['last_review'], 'freq_rank': rank, 'sources': 'anki', 'tags': ' '.join(tags), 'notes': ''}
app = 0
for f in sorted(glob.glob(f'{seed}/L0*/*.json')):
    for it in json.load(open(f)):
        if it['kind'] not in ('vocab', 'expression'): continue
        word = it['word'] if it['kind'] == 'vocab' else it['text']
        meaning = '; '.join(it['meanings'][:2]) if it['kind'] == 'vocab' else it['meaning']
        hanja = ''.join(h['hanja'] for h in it.get('hanjaBreakdown') or []) if it['kind'] == 'vocab' else (it.get('hanjaText') or '')
        r = rows.get(word)
        if r:
            r['sources'] = 'anki app'; r['tags'] = (r['tags'] + f" app-L{it['level']}").strip()
        else:
            rows[word] = {'word': word, 'meaning': meaning, 'hanja': hanja, 'pos': it.get('pos', it.get('subtype', '')), 'status': 'new',
                'times_missed': 0, 'times_seen': 0, 'last_seen': '', 'freq_rank': '', 'sources': 'app', 'tags': f"app-L{it['level']}", 'notes': ''}
        app += 1
order = {'learning': 0, 'new': 1, 'suspended': 3, 'mastered': 2}
data = sorted(rows.values(), key=lambda r: (order[r['status']], -int(r['times_missed']), r['word']))
with open(out_csv, 'w', newline='', encoding='utf-8') as fh:
    wr = csv.DictWriter(fh, fieldnames=COLS); wr.writeheader(); wr.writerows(data)
from collections import Counter
print('rows', len(data), Counter(r['status'] for r in data), 'app items', app)
# shaky-words import (young/learning in Anki), as private custom items
seed_items = [it for f in glob.glob(f'{seed}/L0*/*.json') for it in json.load(open(f))]
seed_words = {it.get('word') or it.get('text') for it in seed_items}
seed_ids = {it['id'] for it in seed_items}
items = []
for w in sorted((w for w in words if w['status'] in ('young', 'learning')), key=lambda w: -w['lapses']):
    if w['word'] in seed_words or f"v:{w['word']}" in seed_ids or not w['meaning']: continue
    def norm(m): return re.sub(r'^(to|a|an|the) ', '', re.sub(r'\(.*?\)', '', m.lower())).strip(' .')
    accepted, seenn = [], set()
    for m in (m.strip() for m in re.split(r'[;,]', w['meaning'])):
        if m and norm(m) and norm(m) not in seenn: seenn.add(norm(m)); accepted.append(m)
    accepted = accepted[:6]
    if not accepted: continue
    items.append({'id': f"v:{w['word']}", 'kind': 'vocab', 'level': 1, 'track': 'anki', 'rev': 1, 'unlockDeps': [], 'gating': False,
        'source': {'kind': 'import', 'license': 'personal-use', 'attribution': 'Personal Anki deck (private import)'},
        'needs_review': False, 'tags': ['anki', 'anki-shaky'] + (['anki-leech'] if w['lapses'] >= 8 else []),
        'questionTypes': ['meaning', 'production'],
        'questions': {'meaning': {'accepted': accepted}, 'production': {'promptEn': accepted[0], 'contextHint': f"missed {w['lapses']}× in Anki", 'accepted': [w['word']]}},
        'word': w['word'], 'meanings': accepted, 'pos': 'verb/adj' if w['word'].endswith('다') else 'noun/other', 'register': 'neutral',
        'collocations': [], 'examples': []})
json.dump(items, open(out_import, 'w'), ensure_ascii=False, indent=1)
print('import items', len(items))
