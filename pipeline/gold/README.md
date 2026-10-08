# Gold set for the model bake-off

One JSON object per line, in a `.jsonl` file you create by hand from the mandarin fish PDFs:

```
{"id":"z07-p4-a","lang":"zh","text":"<one passage, 300-1500 characters, copied from the paper>","claims":[{"quote":"<exact sentence from the passage>"}]}
```

- `text`: a passage as it will be fed to the extractor (page text after normalisation).
- `claims`: every welfare-technology claim a careful reader finds in that passage, each with its exact quote. A passage with no claim has `"claims":[]`; include some, they test false positives.
- 20-30 passages, mixed: Chinese and English, dense and empty, at least a few with the `⒚` glyph.
- Do not commit passages from licensed papers. The `.jsonl` files in this folder are git-ignored.
