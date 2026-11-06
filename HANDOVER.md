# Handover

The state of Myrias as of 6 November 2026, and what someone picking it up needs to know.

## What it is

Myrias is an open, bilingual (English and Chinese) evidence base on farmed-animal welfare. Models
read research papers and pull out claims. Code checks each claim's quote against the page it came
from, and a second model checks that the quote supports the claim. Claims about the same practice
and welfare problem are summed up as findings. Findings that rest on two or more papers are turned
into draft actions, which a model ranks against written rules. No expert has audited any of it yet,
and the site says so throughout.

It started with mandarin fish (*Siniperca chuatsi*). Crucian carp was added as a second species to
check that the framework carries over to a new fish without changes.

## Where things are

| What | Where |
|---|---|
| Code and site | `github.com/invi-bhagyesh/myrias` (this repo) |
| Live site | `https://invi-bhagyesh.github.io/myrias/`, deployed from `public/` on every push to `main` (`.github/workflows/pages.yml` runs `npm run check` and `npm test` first) |
| Papers, page text, run records, cost logs | private Hugging Face dataset `invi-bhagyesh/myrias-corpus` |
| Pipeline instructions | `pipeline/README.md` (step by step, with commands) |
| Data format of the release | `docs/export-schema.md` |
| Ranking rules for actions | `pipeline/priority-spec.md` |
| Weekly digest method | `pipeline/digest/METHOD.md` |

The Hugging Face dataset is private because the papers carry many licences. It holds:

- `raw/`: every PDF (633), sorted by species and language, with `index.csv` and `index.json`;
- `mandarin-fish/`: `intake/`, `first-run/`, `run-2/`, `run-3/` and `store/`;
- `crucian-carp/`: `intake/`, `run-1/` and `store/`.

Each `store/` is the running record for its species: the claims with permanent ids, sources,
practices, run logs and the cost ledger.

Keys needed to run the pipeline: `OPENROUTER_API_KEY` (all model calls) and `HF_TOKEN` (upload to
the dataset). Neither is in the repo.

## The site

Static HTML and plain JavaScript, no build step. `public/index.html` loads `public/site.js`, which
reads `public/data/release.json` (the shell: taxonomy, sources, practices, runs) and then the claim,
finding and action files it lists. Pages:

- **Home:** a chart of who wrote the papers, the coverage grid, and how to help.
- **Explore:** a welfare problem by technology grid, per species.
- **Species:** one page per species.
- **Findings and Actions:** filterable lists. Actions show how each was built and why it ranks where
  it does. Earlier versions of actions stay viewable.
- **Review:** an expert review demo for claims and actions. Reviews are saved in the browser and
  exported as JSON or CSV. There is no backend.
- **Feed acclimation:** a focus page for training fish onto formulated feed.
- **Weekly digest:** links to Chinese welfare news, notices and papers.
- **Pipeline:** the framework, a walkthrough of one claim, and the log of every run.
- **Corpus:** every paper retrieved, with how far it got and why.
- **Methods, Download.**

To run it locally: `npm run dev`, then open `http://localhost:5173`. Tests: `npm test` (100 tests,
about 15 seconds).

English and Chinese text is in `public/i18n.js`. The Chinese is a draft and has not been reviewed by a
native speaker with welfare knowledge.

## How a run works

The order of steps and every command is in `pipeline/README.md`. In short:

1. **Search** (`intake.mjs`): Europe PMC, Crossref, DOAJ, OpenAlex and Semantic Scholar.
2. **Screen:** keep papers that name the fish in the title and touch a welfare topic.
3. **Fetch** open full text.
4. **Prepare the text:** `normalize.py`, then `prepare.mjs`.
5. **Extract claims** (`run.mjs`).
6. **Check and map** (`claimstage.mjs map`).
7. **Verify** (`claimstage.mjs verify`).
8. **Render English** (`render.mjs`).
9. **Reconcile practice names** (`reconcile.mjs`).
10. **Merge** into the species store (`merge.mjs`).
11. **Export** the release (`export.mjs`).
12. **Cluster, findings, actions, rank** (`cluster.mjs`, `findings.mjs`, `actions.mjs`, `rank.mjs`).
13. **Affiliations** (`affiliations.mjs`).
14. **Run log** (`runlog.mjs`).

Every step is wrapped by `step.mjs`, which records inputs, outputs, model calls and cost in the
run's `ledger.jsonl`. Steps that call models resume where they stopped. Map, verify and render skip
a failed call and exit with code 3, so the run script reruns them until every claim is done.

Models are set per step in `pipeline/models.json` (the `demo` profile is in use). Extraction,
mapping and translation use a small fast model. Verification uses a different model family.
Reconcile, findings, actions and ranking use a stronger model.

**Several species in one release:**
- Each species has its own store and its own id range. Crucian carp claims start at C50001,
  sources at S5001, findings at F50001.
- Clustering, findings, actions and ranking take `--species-id` and leave the other species alone.
- `export.mjs` takes `--store` and `--species-id` once per species.

**Cost and time:**
- Mandarin fish run 3, 406 new papers: about $29 and 5 hours.
- Crucian carp run 1, 350 papers: about $24 and 5 hours 20 minutes.
- Costs stay in the private ledgers and are never shown on the site.

## State now

Release 0.5.0:

| | Mandarin fish | Crucian carp |
|---|---|---|
| Papers with claims | 582 | 350 |
| Claims | 17,403 | 11,289 |
| Findings | 1,784 | 868 |
| Ranked actions | 29 | 26 |
| How papers were found | online search plus Chinese papers supplied by hand | online search only |

Crucian carp has no Chinese-language claims. Only 2 of its Chinese papers had open full text, and
neither produced claims. Searching online alone does not reach the Chinese literature. It has to be
supplied, as it was for mandarin fish.

## Weekly digest

`pipeline/digest.mjs` discovers China-related animal welfare links in any language. The daily
collector saves metadata and persistent identities; the weekly command assembles newly discovered
links while retaining original publication dates. Europe PMC uses indexing dates. Wanfang and
OpenAlex adapters use optional `WFDATA_APP_KEY` and `OPENALEX_API_KEY` secrets. Missing keys are shown
as skipped sources. Existing issues cannot be overwritten by a failed run or a rerun.

`.github/workflows/digest.yml` collects daily at 09:17 Beijing, saves its checkpoint on
`automation/weekly-digest`, and proposes completed Friday issues through a PR. Merging that PR
publishes through the existing Pages workflow. See `pipeline/digest/METHOD.md` for setup, commands,
source limitations and recovery. Summaries and email delivery remain future work.

## Working rules so far

- Work on a branch and merge to `main` by pull request (squash). `main` deploys the site.
- No licensed text in the repo or on the site: short quotes and bibliographic details only.
  Abstracts, full text and PDFs stay in the private dataset.
- No costs on the site.
- Site wording: plain, short, factual. Recent work removed text that read as machine-written; keep
  it that way.
- Run records are kept: `versions.mjs` archives earlier claims, findings and actions, and the site
  links them.

## Open items

- **Expert audit.** Nothing has been audited. The review page is a front-end demo. A backend, or a
  shared sheet, is needed before expert reviews can be collected.
- **OpenAlex** now needs an API key tied to an email address. It was unavailable for crucian carp.
- **Pipeline page and Corpus header** still describe mandarin fish only. The run log, paper list and
  species pages cover both species.
- **README.md** is out of date: it describes the site as pre-release.
- **Chinese wording.** Some Chinese strings still include sentences that were trimmed from the
  English.
- **Digest:** summaries, a hand-added links file for WeChat posts, more sources
  and email. See its method notes.
- **Chinese full text** remains the main gap. CNKI and Wanfang are paywalled, and several Chinese
  government sites time out from outside China.
