# Screening and rules: current state and proposed changes

Status as of 2026-10-09. Written to be read without the code.

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

I read its README, VISION, AGENTS, the schema, the lint rules and the triage job spec. **No change in Myrias is based on it yet.** The ideas below come from comparing the two.

## Proposed changes (not built)

1. Overlapping chunks with page locators instead of one page per call, so claims that span a page break are not lost.
2. A dedup stage before extraction (file hash, DOI, normalised title).
3. Recall measurement: a hand-made gold set from 6 to 8 papers, and a recall gate on each run (WelfareLens does this with anchors and a holdout set).
4. Resolve interventions properly (strict clusters, ambiguous cases left separate), replacing the one-name-per-cell shortcut.
5. Run safety: atomic budget reservation, SQLite checkpoints with resume, input and config hashes.
6. Extract negative, null and speculative claims as their own kinds.
7. Find more papers with a fixed query list over open Chinese indexes. Check permissions first.

## Open decisions

- May IAA's methods or schema be reused in a public project and paper? (`FRAMEWORK.md`)
- Who audits claims, and in which languages.
- Licensing for the quotations shown on the site.
