# Anki → master list tools

Run with `python3 -I`. Private inputs and outputs live in `data-private/` (git-ignored).

1. Unzip the `.apkg`, then decompress `collection.anki21b` with Node: `zlib.zstdDecompressSync`.
2. `analyze.py <collection.sqlite> <outdir>` writes per-word stats (`anki_words.json`) and a summary.
3. `level.py <outdir> packages/content/seed` prints the frequency-band level estimate and the overlap with the seed.
4. `master.py <anki_words.json> packages/content/seed <master.csv> <shaky-import.json>` writes the raw master list and the import of shaky words. The import skips words and ids that are already in the seed.
5. `consolidate.py <raw.csv> <master.csv>` is idempotent. It:
   - deduplicates glosses
   - merges noun + 하다/되다 pairs that share a meaning
   - adds `similar:` links
