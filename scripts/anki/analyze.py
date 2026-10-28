import sqlite3, re, json, sys, html, collections, datetime as dt
src, outdir = sys.argv[1], sys.argv[2]
c = sqlite3.connect(src)
c.create_collation('unicase', lambda a, b: (a.lower() > b.lower()) - (a.lower() < b.lower()))
def clean(s): return html.unescape(re.sub(r'<[^>]+>|\[sound:[^\]]+\]', ' ', s or '')).replace('\xa0', ' ').strip()
def headkey(w):
    w = clean(w); w = re.sub(r'\(.*?\)|\[.*?\]', '', w); w = re.sub(r'[0-9０-９]+$', '', w.strip())
    return re.sub(r'\s+', ' ', w).strip()
HEAD = {'Basic+++': 'Front', 'Detailed Korean': 'Korean Word', 'Korean 11k Note': 'word', 'Korean Vocab': 'Front', 'KoreanCore5k': 'Front'}
MEAN = {'Basic+++': 'Back', 'Detailed Korean': 'English Meaning', 'Korean 11k Note': 'translation', 'Korean Vocab': 'Back', 'KoreanCore5k': 'Back'}
RANK = {'Korean 11k Note': 'sort_order', 'Korean Vocab': 'Number', 'KoreanCore5k': 'Order'}
HANJA = {'Korean Vocab': 'Hanja', 'KoreanCore5k': 'Vocab-Hanja'}
nts = {mid: (name, [r[0] for r in c.execute('select name from fields where ntid=? order by ord', (mid,))]) for mid, name in c.execute('select id,name from notetypes')}
decks = {i: n.replace('\x1f', ' :: ') for i, n in c.execute('select id,name from decks')}
now_ms = max(r[0] for r in c.execute('select max(id) from revlog'))
words = {}
cardstate = collections.Counter(); deckstate = collections.defaultdict(collections.Counter)
for nid, mid, flds, tags in c.execute('select id,mid,flds,tags from notes'):
    name, fn = nts[mid]; f = dict(zip(fn, flds.split('\x1f')))
    k = headkey(f.get(HEAD[name], ''))
    if not k or not re.search('[가-힣]', k): continue
    w = words.setdefault(k, {'word': k, 'meanings': [], 'hanja': '', 'ranks': {}, 'decks': set(), 'cards': []})
    m = clean(f.get(MEAN[name], ''))
    if m and m not in w['meanings']: w['meanings'].append(m[:120])
    if name in HANJA and not w['hanja']: w['hanja'] = clean(f.get(HANJA[name], ''))
    if name in RANK:
        try: w['ranks'][name] = int(re.sub(r'\D', '', f.get(RANK[name], '')) or 0) or None
        except ValueError: pass
    if 'firstblock' in tags or 'bydifficulty' in tags: w['decks'].add('kimchi')
    for cid, did, typ, queue, ivl, reps, lapses in c.execute('select id,did,type,queue,ivl,reps,lapses from cards where nid=?', (nid,)):
        st = 'suspended' if queue < 0 else 'new' if typ == 0 else 'mature' if ivl >= 21 else 'young' if typ == 2 else 'learning'
        cardstate[st] += 1; deckstate[decks.get(did, '?')][st] += 1
        w['decks'].add(decks.get(did, '?')); w['cards'].append({'st': st, 'ivl': ivl, 'reps': reps, 'lapses': lapses, 'cid': cid})
# revlog
last = {}; rev = collections.Counter(); monthly = collections.Counter(); ret = collections.Counter()
for cid, rid, ease, typ, lastivl in c.execute('select cid,id,ease,type,lastIvl from revlog'):
    last[cid] = max(last.get(cid, 0), rid)
    monthly[dt.datetime.utcfromtimestamp(rid / 1000).strftime('%Y-%m')] += 1
    if typ == 1 and ease > 0:
        recent = rid > now_ms - 90 * 86400_000
        bucket = ('mature' if lastivl >= 21 else 'young') + ('_90d' if recent else '_all')
        ret[bucket + '_n'] += 1; ret[bucket + '_pass'] += ease > 1
        if recent: ret['all_90d_n'] += 1; ret['all_90d_pass'] += ease > 1
order = ['mature', 'young', 'learning', 'new', 'suspended']
out = []
for w in words.values():
    best = min((cd['st'] for cd in w['cards']), key=lambda s: order.index(s)) if w['cards'] else 'new'
    lapses = sum(cd['lapses'] for cd in w['cards']); reps = sum(cd['reps'] for cd in w['cards'])
    lr = max((last.get(cd['cid'], 0) for cd in w['cards']), default=0)
    out.append({'word': w['word'], 'meaning': '; '.join(w['meanings'][:2]), 'hanja': w['hanja'], 'status': best,
                'max_ivl': max((cd['ivl'] for cd in w['cards']), default=0), 'lapses': lapses, 'reps': reps,
                'last_review': dt.datetime.utcfromtimestamp(lr / 1000).strftime('%Y-%m-%d') if lr else '',
                'rank11k': w['ranks'].get('Korean 11k Note'), 'rankEvita': w['ranks'].get('Korean Vocab'), 'rankCore': w['ranks'].get('KoreanCore5k'),
                'decks': sorted(w['decks'])})
json.dump(out, open(f'{outdir}/anki_words.json', 'w'), ensure_ascii=False)
summary = {'cards': dict(cardstate), 'decks': {k: dict(v) for k, v in deckstate.items()}, 'unique_words': len(out),
           'word_status': dict(collections.Counter(w['status'] for w in out)), 'retention': dict(ret),
           'monthly': dict(sorted(monthly.items())), 'last_review': dt.datetime.utcfromtimestamp(now_ms / 1000).isoformat()}
json.dump(summary, open(f'{outdir}/anki_summary.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: v for k, v in summary.items() if k != 'monthly'}, ensure_ascii=False, indent=1))
m = summary['monthly']; print('months:', len(m), 'first', min(m), 'last', max(m)); print({k: m[k] for k in list(m)[-12:]})
