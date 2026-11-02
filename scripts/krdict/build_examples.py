"""Build packages/content/examples/krdict-examples.json from a KRDict LMF XML snapshot.

Usage (always with -I; the XML is untrusted input):
  python3 -I scripts/krdict/build_examples.py <upstream_dir> <seed_dir> <sense-map.json> <out.json>
         [--worksheet <file>]   also write a review sheet of the KRDict senses for every item
                                that has more than one candidate sense (for editing sense-map.json)

The parser is a tolerant regex scanner, not an XML parser: some snapshot files are not well-formed
(e.g. a bare "<" inside an attribute value), and nothing in the file is ever evaluated.
Output is deterministic: same inputs give byte-identical output.
"""
import glob
import html
import json
import os
import re
import sys

SOURCE = {
    "name": "한국어기초사전",
    "publisher": "국립국어원",
    "license": "CC BY-SA 2.0 KR",
    "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/kr/",
    "url": "https://krdict.korean.go.kr/",
    "snapshot": "2019-06-26",
}
MAX_PER_ITEM = 12
MAX_DIALOGUES_PREFERRED = 2   # dialogues get at most this many slots while sentences remain
NEAR_DUP = 0.7                # character-bigram Jaccard at or above this counts as a near-duplicate
SPEAKERS = ["가", "나", "다", "라"]

# ---------------------------------------------------------------- tolerant LMF scanner

ENTRY_RE = re.compile(r'<LexicalEntry att="id" val="(\d+)">(.*?)</LexicalEntry>', re.S)
FEAT_RE = re.compile(r'<feat att="([^"]*)" val="([^"]*)"\s*/>')
LEMMA_RE = re.compile(r'<Lemma>\s*<feat att="writtenForm" val="([^"]*)"', re.S)
SENSE_RE = re.compile(r'<Sense att="id" val="(\d+)">(.*?)</Sense>', re.S)
EXAMPLE_RE = re.compile(r'<SenseExample>(.*?)</SenseExample>', re.S)
SUBBLOCK_RE = re.compile(r'<(SenseRelation|SenseExample|Equivalent|Multimedia|RelatedForm|WordForm)>.*?</\1>', re.S)
EQUIV_RE = re.compile(r'<Equivalent>\s*<feat att="language" val="영어"\s*/>\s*<feat att="lemma" val="([^"]*)"', re.S)


def clean(s):
    """Decode entities and normalize whitespace. No other change to the text."""
    s = html.unescape(html.unescape(s))
    return re.sub(r"\s+", " ", s).strip()


def top_feats(block):
    """Feats of a block, ignoring those inside nested sub-blocks."""
    flat = SUBBLOCK_RE.sub("", block)
    out = {}
    for k, v in FEAT_RE.findall(flat):
        out.setdefault(k, clean(v))
    return out


def parse_entry(eid, body):
    head = SENSE_RE.sub("", body)
    feats = top_feats(head)
    lm = LEMMA_RE.search(head)
    if not lm:
        return None
    senses = []
    for sid, sbody in SENSE_RE.findall(body):
        sf = top_feats(sbody)
        examples = []
        for ex in EXAMPLE_RE.findall(sbody):
            pairs = FEAT_RE.findall(ex)
            typ = next((clean(v) for k, v in pairs if k == "type"), "")
            lines = [clean(v) for k, v in pairs if k == "example" and clean(v)]
            if lines:
                examples.append((typ, lines))
        eq = EQUIV_RE.search(sbody)
        senses.append({
            "id": sid,
            "definition": sf.get("definition", ""),
            "en": clean(eq.group(1)) if eq else "",
            "examples": examples,
        })
    word = clean(lm.group(1))
    unit = feats.get("lexicalUnit", "")
    return {
        # Idiom/proverb entries reuse their head word's id, so they are keyed "<id>/<lemma>".
        "id": eid if unit == "단어" else f"{eid}/{word}",
        "word": word,
        "unit": unit,
        "pos": feats.get("partOfSpeech", ""),
        "origin": feats.get("origin", ""),
        "homonym": feats.get("homonym_number", "0"),
        "senses": senses,
    }


def lemma_key(s):
    return re.sub(r"\s+", "", s)


def lemma_keys(s):
    """Lookup keys for a KRDict lemma. Idioms mark optional particles: 발등에 불(이) 떨어지다."""
    with_opt = re.sub(r"\(([^()]*)\)", r"\1", s)
    without_opt = re.sub(r"\([^()]*\)", "", s)
    return {lemma_key(s), lemma_key(with_opt), lemma_key(without_opt)}


def lemma_surfaces(s):
    """Surface forms of a lemma for matching (both optional-particle variants)."""
    a = re.sub(r"\s+", " ", re.sub(r"\(([^()]*)\)", r"\1", s)).strip()
    b = re.sub(r"\s+", " ", re.sub(r"\([^()]*\)", "", s)).strip()
    return [a] if a == b else [a, b]


def load_krdict(upstream_dir, wanted_keys, wanted_ids=frozenset()):
    """Parse only entries whose lemma (spaces removed) is in wanted_keys or whose id is in wanted_ids."""
    entries = {}
    files = sorted(glob.glob(os.path.join(upstream_dir, "*.xml")), key=lambda p: (len(os.path.basename(p)), p))
    if not files:
        sys.exit(f"no *.xml files in {upstream_dir}")
    for path in files:
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
        for m in ENTRY_RE.finditer(text):
            body = m.group(2)
            lm = LEMMA_RE.search(body)
            if not lm:
                continue
            if m.group(1) not in wanted_ids and not (lemma_keys(clean(lm.group(1))) & wanted_keys):
                continue
            e = parse_entry(m.group(1), body)
            if e:
                entries[e["id"]] = e
    return entries

# ---------------------------------------------------------------- seed items


def load_seed(seed_dir):
    items = []
    for path in sorted(glob.glob(os.path.join(seed_dir, "*", "*.json"))):
        with open(path, encoding="utf-8") as fh:
            for it in json.load(fh):
                if it.get("kind") == "vocab":
                    items.append({"id": it["id"], "kind": "vocab", "word": it["word"], "pos": it["pos"],
                                  "meanings": it.get("meanings", []), "examples": [e["ko"] for e in it.get("examples", [])],
                                  "collocations": [c["ko"] for c in it.get("collocations", [])]})
                elif it.get("kind") == "expression":
                    items.append({"id": it["id"], "kind": "expression", "word": it["text"], "pos": it["subtype"],
                                  "meanings": [it.get("meaning", "")], "examples": [e["ko"] for e in it.get("examples", [])],
                                  "collocations": []})
    return items


POS_COMPAT = {
    "동사": {"동사", "보조 동사"},
    "형용사": {"형용사", "보조 형용사"},
    "명사": {"명사", "의존 명사"},
    "부사": {"부사"},
    "관형사": {"관형사"},
    "관형사·명사": {"관형사", "명사"},
    "사자성어": {"명사"},
}


def candidates(item, by_key):
    found = by_key.get(lemma_key(item["word"]), [])
    if item["pos"] in ("관용구", "속담"):
        return [e for e in found if e["unit"] == item["pos"]]
    allowed = POS_COMPAT.get(item["pos"])
    if allowed is None:
        return []
    return [e for e in found if e["pos"] in allowed and e["unit"] == "단어"]

# ---------------------------------------------------------------- Hangul + stem matching

SBASE, NJUNG, NJONG = 0xAC00, 21, 28
J_A, J_AE, J_EO, J_E, J_YEO, J_O, J_WA, J_OE, J_U, J_WO, J_EU, J_I = 0, 1, 4, 5, 6, 8, 9, 11, 13, 14, 18, 20
F_N, F_D, F_L, F_M, F_B, F_S, F_SS, F_H = 4, 7, 8, 16, 17, 19, 20, 27
C_R, C_NG = 5, 11


def is_syl(ch):
    return 0xAC00 <= ord(ch) <= 0xD7A3


def dec(ch):
    o = ord(ch) - SBASE
    return o // (NJUNG * NJONG), (o % (NJUNG * NJONG)) // NJONG, o % NJONG


def syl(c, v, j=0):
    return chr(SBASE + (c * NJUNG + v) * NJONG + j)


def bright(ch):
    return is_syl(ch) and dec(ch)[1] in (J_A, J_O)


# Syllables an inflectional ending (or an attached 지다 / auxiliary) can start with.
ENDING_START = set(
    "거건걸게겠겨고곤구군기길까께나냐네느는니다단답대더던데도되된될든듯디라랍래러렀려렵로리"
    "며면므렴서선세셔셨소쇼습시신실십아았야어었여였오요우으은을음읍자잖죠지진질져졌짐치")
AUX_START = set("주줬준줄줍버봐봤본볼보놓놨내냈있오와왔가갔간갈두둔뒀둬")


def stem_forms(stem):
    """Surface prefixes a verb/adjective stem can take before an ending."""
    if not stem or not is_syl(stem[-1]):
        return [stem] if stem else []
    p, last = stem[:-1], stem[-1]
    c, v, j = dec(last)
    out = [stem]
    if j == 0:
        out += [p + syl(c, v, f) for f in (F_N, F_L, F_M, F_B, F_SS)]
        if last == "하":
            out += [p + "해", p + "했"]
        elif v == J_O:
            out += [p + syl(c, J_WA), p + syl(c, J_WA, F_SS)]
        elif v == J_U:
            out += [p + syl(c, J_WO), p + syl(c, J_WO, F_SS)]
        elif v == J_I:
            out += [p + syl(c, J_YEO), p + syl(c, J_YEO, F_SS)]
        elif v == J_OE:
            out += [p + syl(c, 10), p + syl(c, 10, F_SS)]   # 되 → 돼, 됐
        elif v == J_EU:
            if c == C_R and p and is_syl(p[-1]):            # 르 irregular: 기르 → 길러, 모르 → 몰라
                pc, pv, pj = dec(p[-1])
                base = p[:-1] + syl(pc, pv, F_L)
                for vv in (J_A, J_EO):
                    out += [base + syl(C_R, vv), base + syl(C_R, vv, F_SS)]
            vv = J_A if (p and bright(p[-1])) else J_EO       # ㅡ drop: 쓰 → 써, 바쁘 → 바빠
            out += [p + syl(c, vv), p + syl(c, vv, F_SS)]
    else:
        open_ = p + syl(c, v)
        if j == F_B:                                           # ㅂ irregular: 괴롭 → 괴로워
            out += [open_ + s for s in ("우", "워", "와", "운", "울", "움", "웠", "왔")]
        elif j == F_D:                                         # ㄷ irregular: 걷 → 걸어
            out += [p + syl(c, v, F_L) + s for s in ("어", "었", "아", "았", "으", "은", "을", "음")]
        elif j == F_S:                                         # ㅅ irregular: 짓 → 지어
            out += [open_ + s for s in ("어", "었", "아", "았", "으", "은", "을", "음")]
        elif j == F_H and v == J_O:                            # 놓아 → 놔, 놓았 → 놨
            out += [p + syl(c, J_WA), p + syl(c, J_WA, F_SS)]
        elif j == F_L:                                         # ㄹ drop: 빌 → 비는, 빈, 빕니다
            out += [open_ + s for s in ("는", "니", "세", "시", "셨", "오", "십")]
            out += [p + syl(c, v, F_N), p + syl(c, v, F_B)]
    seen, res = set(), []
    for f in out:
        if f not in seen:
            seen.add(f)
            res.append(f)
    return res


EOJEOL_RE = re.compile(r"\S+")
LEAD_PUNCT = "\"'“‘(「『[<《〈-—…·"
TRAIL_PUNCT = ".,!?\"'”’)」』]>》〉…:;~·-—"


def eojeols(text):
    """(start, end) of each eojeol with leading/trailing punctuation trimmed."""
    out = []
    for m in EOJEOL_RE.finditer(text):
        s, e = m.start(), m.end()
        while s < e and text[s] in LEAD_PUNCT:
            s += 1
        while e > s and text[e - 1] in TRAIL_PUNCT:
            e -= 1
        if s < e:
            out.append((s, e))
    return out


def spaced_regex(s):
    """Literal regex for s that also allows an optional space between syllables (보조 용언 띄어쓰기)."""
    parts = [re.escape(ch) for ch in s if not ch.isspace()]
    return " ?".join(parts)


def find_predicate(text, word):
    """Match a verb/adjective (or a phrase ending in one). Returns the inflected surface or None."""
    words = word.split()
    head, last = words[:-1], words[-1]
    if not last.endswith("다"):
        return None
    stem = last[:-1]
    forms = stem_forms(stem)
    prefix = (" ".join(head) + " ") if head else ""
    spans = eojeols(text)
    best = None
    for form in forms:
        target = prefix + form
        pat = re.compile(spaced_regex(target) if not head else re.escape(prefix) + spaced_regex(form))
        for m in pat.finditer(text):
            st = m.start()
            span = next(((s, e) for s, e in spans if s <= m.end() - 1 < e), None)
            first = next(((s, e) for s, e in spans if s <= st < e), None)
            if not span or not first or first[0] != st:
                continue                                       # must start an eojeol
            rest = text[m.end():span[1]]
            ok = rest == "" or rest[0] in ENDING_START or (len(stem) >= 2 and rest[0] in AUX_START)
            if not ok:
                continue
            cand = (st, -(m.end() - st), text[st:span[1]])
            if best is None or cand < best:
                best = cand
    return best[2] if best else None


NOUN_FOLLOW = set("이가은는을를의에와과도만로으라께처보부까마조밖뿐야나든랑하되적스시들들께엔엘")


def find_word(text, word):
    """Match a noun/adverb/determiner (or a fixed phrase). Returns the exact surface or None."""
    pat = re.compile(spaced_regex(word))
    spans = eojeols(text)
    best = None
    for m in pat.finditer(text):
        st, en = m.start(), m.end()
        span = next(((s, e) for s, e in spans if s <= st < e), None)
        if not span:
            continue
        at_start = span[0] == st
        rest = text[en:span[1]]
        if at_start and (rest == "" or rest[0] in NOUN_FOLLOW):
            score = 0
        elif at_start:
            score = 1
        elif len(word.replace(" ", "")) >= 2:
            score = 2                                          # inside a compound (e.g. 소비자물가)
        else:
            continue
        cand = (score, st, text[st:en])
        if best is None or cand < best:
            best = cand
    return best[2] if best else None


IDIOM_PARTICLES = set("을를이가은는도만에의")


def find_phrase_loose(text, phrase):
    """Proverbs/idioms quoted with a changed ending: keep the phrase, let the final word's tail vary."""
    words = phrase.split()
    if len(words) < 2:
        return None
    last = words[-1]
    keep = last[:-1]                                           # 모른다 → 모른, 누기 → 누
    if last.endswith("다") and keep and is_syl(keep[-1]) and dec(keep[-1])[2] == F_N:
        c, v, _ = dec(keep[-1])                                # present -ㄴ다: 뺀다 → 빼, 모른다 → 모르
        keep = keep[:-1] + syl(c, v)
    if not keep:
        keep = last[:1]
    parts = []
    for w in words[:-1]:                                       # 변죽을 울리다 ~ 변죽만 울리는
        if len(w) >= 2 and w[-1] in IDIOM_PARTICLES:
            parts.append(spaced_regex(w[:-1]) + "(?:" + "|".join(sorted(IDIOM_PARTICLES)) + ")")
        else:
            parts.append(spaced_regex(w))
    m = re.search(" ?".join(parts + [spaced_regex(keep)]), text)
    if not m:
        return None
    end = m.end()
    while end < len(text) and not text[end].isspace() and text[end] not in TRAIL_PUNCT:
        end += 1
    return text[m.start():end]


def find_match(text, item, lemma_words):
    """Try the app item's own surface first, then the KRDict lemma(s) it was aligned to."""
    for w in [item["word"]] + [x for x in lemma_words if x != item["word"]]:
        if w.endswith("다"):
            r = find_predicate(text, w)
            if r is None and " " in w:
                r = find_word(text, w) or find_phrase_loose(text, w)
        else:
            r = find_word(text, w)
        if r:
            return r
    return None

# ---------------------------------------------------------------- selection


def norm(s):
    return re.sub(r"[^\w]", "", re.sub(r"^[가-하]: ", "", s))


def bigrams(s):
    s = norm(s)
    return {s[i:i + 2] for i in range(len(s) - 1)} or {s}


def near_dup(a, b):
    inter = len(a & b)
    return inter / max(1, len(a | b)) >= NEAR_DUP


def resolve_senses(item, cands, smap, entries):
    """Returns ([(entry, sense)], status). status: 'ok' | 'none' | 'unresolved'."""
    spec = smap.get(item["id"])
    if spec is None:
        if not cands:
            return [], "none"
        total = sum(len(e["senses"]) for e in cands)
        single_entry_group = len(cands) == 1 or item["pos"] == "관형사·명사"
        if total == len(cands) and single_entry_group:
            return [(e, s) for e in cands for s in e["senses"]], "ok"
        return [], "unresolved"
    if spec == "all":
        if len(cands) != 1 and item["pos"] != "관형사·명사":
            sys.exit(f"sense-map: {item['id']} is 'all' but has {len(cands)} candidate entries; list sense ids")
        return [(e, s) for e in cands for s in e["senses"]], "ok"
    out = []
    for ref in spec:
        eid, _, sid = ref.rpartition(":")
        e = entries.get(eid)
        if e is None:
            sys.exit(f"sense-map: {item['id']} refers to unknown KRDict entry {eid}")
        chosen = e["senses"] if sid == "*" else [s for s in e["senses"] if s["id"] == sid]
        if not chosen:
            sys.exit(f"sense-map: {item['id']} refers to unknown sense {ref}")
        out += [(e, s) for s in chosen]
    return out, ("ok" if out else "none")


def build_item(item, picked):
    # An expression aligned to a plain word's sense (물꼬를 트다 -> 물꼬) must match its own phrase;
    # otherwise the KRDict lemma is a fallback surface (마지못해 -> 마지못하다, 상쇄 -> 상쇄하다).
    lemma_words = sorted({w for e, _ in picked for w in lemma_surfaces(e["word"])
                          if item["kind"] == "vocab" or e["unit"] != "단어"})
    seen_sets = [bigrams(x) for x in item["examples"]]
    per_sense_sent, per_sense_dlg = [], []
    for e, s in picked:
        sents, dlgs = [], []
        for typ, lines in s["examples"]:
            if typ == "문장" and len(lines) == 1:
                m = find_match(lines[0], item, lemma_words)
                if m:
                    sents.append({"kind": "sentence", "ko": lines[0], "match": m})
            elif typ == "대화" and 2 <= len(lines) <= len(SPEAKERS):
                labeled = [f"{SPEAKERS[i]}: {ln}" for i, ln in enumerate(lines)]
                for i, ln in enumerate(labeled):
                    m = find_match(ln[3:], item, lemma_words)
                    if m:
                        dlgs.append({"kind": "dialogue", "lines": labeled, "match": m, "matchLine": i})
                        break
        per_sense_sent.append(sents)
        per_sense_dlg.append(dlgs)

    def round_robin(groups):
        out, i = [], 0
        while any(i < len(g) for g in groups):
            for g in groups:
                if i < len(g):
                    out.append(g[i])
            i += 1
        return out

    sents, dlgs = round_robin(per_sense_sent), round_robin(per_sense_dlg)

    def dedupe(lst):
        kept = []
        for ex in lst:
            text = ex["ko"] if ex["kind"] == "sentence" else " ".join(ex["lines"])
            bg = bigrams(text)
            if any(near_dup(bg, o) for o in seen_sets):
                continue
            seen_sets.append(bg)
            kept.append(ex)
        return kept

    sents, dlgs = dedupe(sents), dedupe(dlgs)
    # Sentences first; dialogues fill the remaining slots, with up to MAX_DIALOGUES_PREFERRED
    # slots kept for them even when there are enough sentences, for variety.
    n_sent = min(len(sents), MAX_PER_ITEM - min(len(dlgs), MAX_DIALOGUES_PREFERRED))
    n_dlg = min(len(dlgs), MAX_PER_ITEM - n_sent)
    return sents[:n_sent] + dlgs[:n_dlg]


def write_worksheet(path, rows):
    with open(path, "w", encoding="utf-8") as fh:
        for item, cands in rows:
            fh.write(f"### {item['id']}  [{item['pos']}]\n  meanings: {' | '.join(item['meanings'])}\n")
            if item["collocations"]:
                fh.write(f"  colloc: {' / '.join(item['collocations'])}\n")
            for x in item["examples"]:
                fh.write(f"  ex: {x}\n")
            for e in cands:
                fh.write(f"  [{e['id']}] {e['word']} {e['pos']} {e['origin']} (homonym {e['homonym']})\n")
                for s in e["senses"]:
                    first = next((ln[0] for t, ln in s["examples"] if t == "문장"), "")
                    fh.write(f"    {e['id']}:{s['id']}  {s['definition']}  <{s['en']}>  e.g. {first}\n")
            fh.write("\n")


def main(argv):
    args = argv[1:]
    worksheet = None
    if "--worksheet" in args:
        i = args.index("--worksheet")
        worksheet = args[i + 1]
        del args[i:i + 2]
    if len(args) != 4:
        sys.exit(__doc__)
    upstream, seed_dir, map_path, out_path = args
    items = load_seed(seed_dir)
    with open(map_path, encoding="utf-8") as fh:
        smap = {k: v for k, v in json.load(fh).items() if not k.startswith("_")}
    unknown = sorted(set(smap) - {it["id"] for it in items})
    if unknown:
        sys.exit(f"sense-map has ids that are not seed items: {unknown}")

    wanted = {lemma_key(it["word"]) for it in items}
    referenced = {ref.rpartition(":")[0].partition("/")[0] for v in smap.values() if isinstance(v, list) for ref in v}
    entries = load_krdict(upstream, wanted, referenced)
    by_key = {}
    for e in sorted(entries.values(), key=lambda e: (int(e["id"].partition("/")[0]), e["id"])):
        for k in sorted(lemma_keys(e["word"])):
            by_key.setdefault(k, []).append(e)

    out_items, unresolved, review = {}, [], []
    for item in items:
        cands = candidates(item, by_key)
        picked, status = resolve_senses(item, cands, smap, entries)
        if status == "unresolved":
            unresolved.append(item["id"])
        if worksheet and cands and (sum(len(e["senses"]) for e in cands) > 1):
            review.append((item, cands))
        if status != "ok":
            continue
        exs = build_item(item, picked)
        if exs:
            out_items[item["id"]] = exs

    if worksheet:
        write_worksheet(worksheet, review)
    doc = {"format": 1, "source": SOURCE, "items": dict(sorted(out_items.items()))}
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write('{"format":1,\n"source":' + json.dumps(SOURCE, ensure_ascii=False) + ',\n"items":{\n')
        keys = list(doc["items"])
        for n, k in enumerate(keys):
            fh.write(json.dumps(k, ensure_ascii=False) + ":[\n")
            exs = doc["items"][k]
            fh.write(",\n".join(json.dumps(x, ensure_ascii=False, separators=(",", ":")) for x in exs))
            fh.write("\n]" + ("," if n < len(keys) - 1 else "") + "\n")
        fh.write("}}\n")

    counts = sorted(len(v) for v in out_items.values())
    print(f"items with examples: {len(out_items)}/{len(items)}; examples: {sum(counts)}", file=sys.stderr)
    if unresolved:
        print(f"unresolved (multiple senses/entries, not in sense-map; skipped): {len(unresolved)}", file=sys.stderr)
        for x in unresolved:
            print(f"  {x}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv)
