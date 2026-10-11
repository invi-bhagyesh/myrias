# Landscape export schema — `myrias-landscape/1`

The public site reads one static JSON file (`public/data/release.json`) and renders everything
from it. The pipeline (not yet built) will generate this file from its store at each release.
The rules below are enforced by `validateExport` in `public/site-lib.js`, which the site runs on
load and the tests run in CI. `public/data/sample.json` is a flagged placeholder export for
testing the layout; open `index.html?data=sample` to see it.

## Top level
| Key | Content |
|---|---|
| `schema` | must equal `myrias-landscape/1` |
| `release` | `version`, `as_of`, `status` (`pre-release` or `released`), `sample` (boolean, required), `licence` (string or null), `note_en`, `note_zh` |
| `taxonomy` | arrays `technology_classes`, `welfare_problems`, `maturity`, `outcome_evidence`; each entry `{id, en, zh}`; `draft: true` while the taxonomy is provisional |
| `species` | `{id, common_en, common_zh, scientific, group, run_status, summary_en, summary_zh}` |
| `sources` | bibliographic records only: `{id, title, title_en, authors[], year, lang, venue, doi, url, access, licence_note}` |
| `claims` | see below |
| `interventions` | `{id, name_en, name_zh, technology_class}` |
| `applications` | intervention x species in one welfare problem: `{id, intervention_id, species_id, technology_class, welfare_problem, maturity, outcome_evidence, claim_ids[]}` |
| `cells_status` | explicit `probed_empty` / `not_collected` marks: `{species_id, technology_class, welfare_problem, status}` |
| `runs` | `{id, species_id, status, focus_en, focus_zh, counts{}, models[], audit{n, precision, ci}, changelog[]}` |
| `methods` | `limits_en[]`, `limits_zh[]` (added to the fixed limits shown on the methods page) |

## Claim

**The source language is the record.** For a claim from a Chinese source, `statement` holds the
statement in Chinese, written at extraction, with `statement_lang: "zh"`; `text_zh` equals it. The
English `text_en` is a derived view beside it, never a replacement: it carries `rendering {model,
version, check}`, and a rendering is published only when its number check passed (every number in
the record appears in the English). Without one, the site shows the record. Claims from releases
before extract v0.3 have an English `text_en` written at extraction and no `statement`.

`{id, source_id, species_id, locator{page, start, end}, quote, quote_lang, text_en, text_zh,
kind, population{species, life_stage, system}, intervention, comparator, outcome, direction,
magnitude, welfare_link, welfare_link_note, verification, audit}`

- `kind`: `measured`, `reported_background`, `inferred`, `speculative`
- `verification`: `unchecked`, `supported`, `partial`, `unsupported`
- `welfare_link`: `direct`, `proxy`, `none`
- `audit`: `audited`, `not_audited`

## Publishing rules (enforced)
- A real release (`sample: false`) may contain only `supported` and `partial` claims. Unsupported
  and unchecked claims stay in the pipeline store.
- Every claim has a source, a locator, a verbatim quote of at most 600 characters, and a statement:
  the record in its source language, an English statement, or both. An English rendering of a
  non-English record must carry its provenance and a passed check, and `text_zh` may never differ
  from a Chinese record.
- No full text: keys such as `fulltext`, `full_text`, `body_text`, `pdf`, `markdown` are rejected
  anywhere in the export.
- Every application cites at least one claim; all ids resolve; ids are unique.
- A matrix cell with no applications is shown as `probed_empty` (every selected species was marked
  searched) or `not_collected`. It is never left blank.
- Chinese interface and taxonomy text is a draft until a native speaker has reviewed it.
