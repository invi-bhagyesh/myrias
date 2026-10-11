# Screening and rules: current state and proposed changes

Status as of 2026-10-11. Written to be read without the code.

## What is in the repository today (built, on `main`)

Screening and rules are in four places.

| What | Where | What it does |
|---|---|---|
| Relevance screen (folded into mapping) | `pipeline/prompts.mjs` (`MAP_SYSTEM`), run by `pipeline/claimstage.mjs map` | A model marks each claim welfare-relevant or not (breeding doses and basic biology are not), and labels technology class, welfare problem, kind, link to welfare and evidence strength from a fixed taxonomy |
| Quote check | `pipeline/quote.mjs` | Deterministic. A claim's quote must appear on its page after normalising spacing, punctuation width and known PDF glyph errors. It can only reject |
| Support check | `pipeline/claimstage.mjs verify` | A second model, from a different lab than the extractor, judges the quote supports, partly supports or does not support the statement, from the quote alone |
| Publishing rules | `public/site-lib.js` (`validateExport`), documented in `docs/export-schema.md`, tested in `tests/` | A real release may hold only supported or partial claims, each with a quote of at most 600 characters, a page and an English statement. Full text is rejected. Draft suggestions cannot be published |

Models per stage are set in `pipeline/models.json` (profiles `demo` and `full`). The site's Pipeline tab shows every stage.

First run, mandarin fish, 14 Chinese-language papers: 231 claims extracted, 206 passed the quote check, 120 were relevant to welfare technology, all 120 supported or partly supported, released in `public/data/release.json`. No expert has audited these.

## Relationship to WelfareLens (Robert's repository)

WelfareLens is a large-scale discovery funnel (67k extraction tasks, mostly metadata and abstracts)
feeding a private research wiki. Myrias is a small full-text pipeline that checks every claim against
its page and publishes the result. Where Myrias was ahead: a verbatim quote on every claim checked by
code (WelfareLens's stage-1 `source_support` allows paraphrase), a second model from another lab
judging every claim, claims from Chinese full text (their Chinese intake is metadata only), and a
public site. Where WelfareLens was ahead: claim richness, dedup, chunking, identity resolution,
recall gates and run safety.

## Adopted from WelfareLens (built and tested; not yet run on real data)

| Idea from WelfareLens | What Myrias now does | Where |
|---|---|---|
| Stage 0 eligibility and dedup | Drops duplicate papers (same text, or same title under another file name) before any model call, with a reason for each | `pipeline/dedup.mjs` |
| Overlapping, locator-preserving chunks | Reads each paper in 1,800-character windows overlapping by 300; a quote is located back to its page; duplicates from the overlaps are merged | `pipeline/chunk.mjs` |
| Rich `EvidenceClaim` (measured vs claimed vs inferred, polarity, speculative, counterevidence, limitations, uncertainties) | Extraction v0.2 adds basis, polarity (for, against, no effect, mixed, descriptive), candidate status, intervention key, limitations, counterevidence and uncertainty, **while keeping the verbatim quote** | `pipeline/prompts.mjs` |
| Keep negative and speculative evidence | The extractor is told not to drop unfavourable, null or proposed results | `pipeline/prompts.mjs` |
| Intervention keys and conservative grouping | Applications are grouped by intervention key within each cell; evidence-only claims support a cell without forming an application | `pipeline/export.mjs` |
| Hard budget reservations | Each call reserves its worst-case cost before it is sent, so concurrent calls cannot pass the cap | `pipeline/llm.mjs` |
| Durable checkpoints, resume, hashed configuration | Each window is a task with a stable id; finished tasks are checkpointed; a rerun skips them; a run with different inputs or settings refuses to write into an old directory; outputs cut off by the length limit are retried | `pipeline/run.mjs` |
| Recall gates | A run can be scored against a hand-checked gold set and marked fail below a threshold | `pipeline/run.mjs --gold --min-recall` |

The current public release (120 claims) was produced with the earlier version (one page per call,
fewer fields). Re-exporting it with the new code gives an identical release, so nothing on the site
changed. The new fields appear on claim pages once claims are re-extracted. Tests: 53 pass, including
an end-to-end run against a fake model (dedup, windows, quote check, resume without new calls,
refusal to mix settings, recall gate).

## Chinese original as the record (built and tested; not yet run on real data)

The source's original language is the record; any English rendering sits beside it as a derived
view and never replaces it. Extraction v0.3 writes the statement and intervention in Chinese for a
Chinese paper. Verification compares the Chinese quote with the Chinese statement, so a verdict
never depends on a translation. A separate render step adds English with its model and version,
and code checks that every number in the record (including 万 and ranges) survives into the
English; a rendering that fails is not published and the site shows the Chinese record instead.
Claim pages show the record and the English rendering side by side. The validator rejects an
English rendering without provenance or with a failed check, and Chinese text that differs from
the record. Code: `pipeline/prompts.mjs`, `pipeline/render.mjs`, `pipeline/export.mjs`,
`public/site-lib.js`.

## Still to do

1. Build the gold set (6 to 8 papers, every claim listed by a bilingual reader) and set the recall threshold.
2. Re-run extraction on the corpus with v0.2 and compare with v0.1 against the gold set.
3. Resolve interventions across cells (strict clusters; ambiguous ones left separate).
4. Find more papers with a fixed query list over open Chinese indexes, after checking permissions.

## Open decisions

- May IAA's methods or schema be reused in a public project and paper? (`FRAMEWORK.md`)
- Who audits claims, and in which languages.
- Licensing for the quotations shown on the site.
