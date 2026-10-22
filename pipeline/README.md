# Running the framework

This folder holds the pipeline that turns papers into checked claims, findings and draft actions for one
farmed species, and writes the files the site in `../public` reads. This guide takes you from nothing to a
release you can open in the browser. Every command below is run from the repository root.

```
search → screen → fetch full text → prepare pages
  → extract claims → check quotes → map → verify → English text
  → name practices → merge into the store → export
  → cluster practices → write findings → draft actions
```

Each arrow is one script. Scripts read and write plain files, so you can stop after any step, look at the
output, and carry on. Steps that call a model are resumable: if one is stopped, run the same command again
and it carries on where it left off.

## What you need

- **Node 22 or newer** (no packages to install; the code uses only Node's own modules).
- **Python 3.11 or newer** with `pymupdf` (`pip install pymupdf`), only for turning PDFs into text.
- **An OpenRouter API key** for every step that calls a model: `export OPENROUTER_API_KEY=...`.
  Searching, screening, fetching, preparing, checking quotes, merging and exporting call no model.
- **A Hugging Face token** (`HF_TOKEN`), only if you want to upload your corpus with `hf_upload.py`.

Check your setup first. This runs the automated tests and needs no key:

```sh
npm test
```

## Where files go

Papers are licensed material, so **keep downloaded papers, abstracts and full text outside this repository**.
Pick a folder for each species and use the same variables for every command:

```sh
export CORPUS=~/myrias-data/mandarin-fish     # everything for one species
export RUN=$CORPUS/runs/run-1                 # one run
export STORE=$CORPUS/store                    # all runs merged; permanent ids live here
mkdir -p "$CORPUS" "$RUN"
```

Only small summary files go into the repository (`public/data/`), never paper text. The site shows short
quotes and bibliographic details only.

## Step by step

### 0. Describe the species

Copy `gap/mandarin-fish.json` to `gap/<your-species>.json` and edit the `species` block: an `id`, the
scientific name, English and Chinese search terms, and `exclude_terms` for look-alikes (for mandarin fish,
the unrelated "mandarin dragonet"). Only the `species` block is used by the search.

### 1. Search, screen and fetch full text

```sh
node pipeline/intake.mjs --species pipeline/gap/mandarin-fish.json --out $CORPUS/intake --fetch
```

Searches Europe PMC, Crossref, DOAJ, OpenAlex and Semantic Scholar in English and Chinese, merges records
that are the same paper, tags each with the welfare topics it touches, and keeps papers that name the
species in the title and touch a welfare topic. `--fetch` downloads open full text. A source that refuses
is written to `status.json`, never skipped silently. The Chinese databases CNKI, Wanfang and CQVIP are not
searched, because they need a licence.

Outputs in `$CORPUS/intake`: `records.jsonl`, `status.json`, `summary.json`, `pdf/`, `xml-pages.jsonl`.

### 2. Turn PDFs into pages

```sh
python3 pipeline/normalize.py $CORPUS/intake/pdf $CORPUS/intake/pdf-pages
```

Writes one text file per paper with a page marker before every page, `pages.jsonl`, and `report.json`
listing pages with no text or garbled glyphs. Pages the report flags as scanned need OCR or a hand
transcription before the next step. If Python cannot find `pymupdf`, run the command without the `-I` flag.

### 3. Prepare the pages a run reads

```sh
node pipeline/prepare.mjs \
  --pages $CORPUS/intake/xml-pages.jsonl,$CORPUS/intake/pdf-pages/pages.jsonl \
  --records $CORPUS/intake/records.jsonl --trim-references --out $RUN/prepare
```

Joins the two page files, cuts everything from the reference list onward (no claims live there, and every
page costs a model call), and writes `pages.jsonl` and `sources.json`.

### 4. Extract claims

```sh
node pipeline/run.mjs --pages $RUN/prepare/pages.jsonl --out $RUN/extract --concurrency 10
```

A model reads each page window and writes every claim with a word-for-word quote. Code then checks that
each quote really is on that page and drops the ones that are not. Output: `claims.jsonl`, plus
`tasks.jsonl` (one line per window, used for resuming) and `summary.json`. Try `--limit 5` first to read
five windows only.

### 5. Map, verify and add English

```sh
node pipeline/claimstage.mjs map    --in $RUN/extract/claims.jsonl --out $RUN/map/mapped.jsonl --concurrency 24
node pipeline/claimstage.mjs verify --in $RUN/map/mapped.jsonl --out $RUN/verify/verified.jsonl --only-relevant --concurrency 16
node pipeline/render.mjs --in $RUN/verify/verified.jsonl --out $RUN/render/final.jsonl
```

- **map**: marks whether each claim is about welfare, and its technology, welfare problem and kind of evidence.
- **verify**: a second model, from a different lab, checks each welfare claim against its quote
  (supported, partly supported or not supported). `--only-relevant` skips claims map marked as not about welfare.
- **render**: writes an English version beside each claim kept in another language; code checks every
  number survives. The original stays the record.

Create the output folders first (`mkdir -p $RUN/map $RUN/verify $RUN/render`).

### 6. Name practices, merge, export

```sh
node pipeline/reconcile.mjs --in $RUN/render/final.jsonl --out $RUN/reconcile/reconciled.jsonl --batch 300
node pipeline/merge.mjs --store $STORE --claims $RUN/reconcile/reconciled.jsonl --run run-1 --phase A \
  --records $CORPUS/intake/records.jsonl
node pipeline/export.mjs --store $STORE --base public/data/release.json --out public/data/release.json
```

- **reconcile** gives each practice one name. On a later run add `--known $STORE/claims.jsonl` so new names
  join the groups you already have.
- **merge** adds only claims that passed (quote on the page, about welfare, supported or partly supported)
  to the store, with permanent ids (`C0001…`, `S001…`). A claim found again is not added twice.
- **export** writes the release the site reads. Your species must be listed under `species` in the base
  `release.json` (id, names, group). If it is not the mandarin fish, add `--species-id <id>`.

### 7. Cluster practices, write findings, draft actions

```sh
node pipeline/cluster.mjs  --release public/data/release.json --store $STORE
node pipeline/findings.mjs --release public/data/release.json --store $STORE --practices $STORE/practices.json
node pipeline/actions.mjs  --release public/data/release.json
node pipeline/rank.mjs     --release public/data/release.json      # ranks against pipeline/priority-spec.md
```

- **cluster** finds the practice names that mean the same practice (embeddings, average-linkage clustering,
  then a model tests each cluster).
- **findings** writes one finding per practice and welfare problem. Counts and strength come from code; the
  sentence comes from a model that sees only the claims; code checks every number against them.
- **actions** drafts next steps from findings backed by two or more papers. Every action stays a draft until
  someone reviews it.
- **rank** has a model rank all actions against each other, following the written spec in
  `pipeline/priority-spec.md` (welfare gain, strength of evidence, whether it can be done now, risk if wrong).
  Each action gets a score, a reason and a note per criterion. To change what priority means, edit the spec and
  run `rank.mjs` again; `--spec FILE` uses another spec. The spec's file name and checksum are stored with the
  ranking.

Every combine step keeps its reason, so the site can show why things were grouped and concluded:
`reconcile` stores each group's reason on its claims (`reconcile_reason`) and in `reconciled.jsonl.groups.json`;
`cluster` stores each cluster's reason in `practice-clusters.json`; each finding carries a `basis` (the names joined
into its practice and why, the counts behind its strength label, and the model's reason for its sentence); each
action carries a `basis` (the model's reason for the action and its type, and the findings it cites). The finding
and action pages show them.

For another species, add `--species-name "<common name> (<scientific name>)"` to `findings` and `actions`.

### 8. Who wrote the papers (optional)

```sh
node pipeline/affiliations.mjs --store $STORE --pages $RUN/prepare/pages.jsonl --out public/data/papers.json
```

A cheap model reads the first two pages of each paper and lists the authors' institutions (country and
sector) and the kind of paper (experiment, field study, methods, review, thesis). Code places each paper by
its first author's institution. Results are cached in `$STORE/paper-meta.json`, so later runs only read new
papers. The home page chart reads `papers.json`.

### 9. Look at it

```sh
npm run dev        # serves public/ at http://localhost:5173
```

Open the Species, Findings, Actions and Pipeline pages. Pages that list claims load them in the background.

## Running a second time

Run 2 builds on run 1; it does not start over. Use a new `RUN` folder, give `merge.mjs` a new `--run run-2
--phase A`, pass `--known $STORE/claims.jsonl` to `reconcile.mjs`, and run `cluster`, `findings`,
`actions` and `rank` again. Findings are only rewritten when their set of claims changes, and existing ids never change,
so links to claims and findings stay valid.

## Choosing models and limits

- `models.json` sets the model for each step and has two profiles, `demo` and `full`. Choose one with
  `MYRIAS_PROFILE=full` or `--profile`. Every claim records the model that produced it.
- All calls go through OpenRouter with provider data collection denied. A step can override provider routing
  in `models.json` (`reconcile`, `cluster`, `findings` and `actions` do).
- There is **no spending limit by default**. Every call's model, tokens and cost are logged, and each step
  reports its total. Add `--cap USD` to `run.mjs`, `claimstage.mjs`, `reconcile.mjs` or `render.mjs` to stop
  before spending more than that; a capped step can be re-run to finish.
- No step sets an output-length limit, so a model is never cut off mid-answer.

## Keeping a log of each run

```sh
node pipeline/runlog.mjs start   --store $STORE --run run-3 --title "Run 3: ..." --release public/data/release.json [--inputs inputs.json] [--note "..."]
# ... the run's steps, each wrapped in step.mjs ...
node pipeline/runlog.mjs finish  --store $STORE --run run-3 --root $RUN --release public/data/release.json
node pipeline/runlog.mjs publish --store $STORE --out public/data/runs.json
```

`start` records the model for each stage, a fingerprint and version of every prompt, the ranking spec's
checksum and the code version, snapshots the store, and lists what changed since the last run: models, prompts,
the spec, and every commit to `pipeline/` since that run ended. Add `--note` for anything code cannot see
(new papers, a fix applied to old data); `note` adds one later. `--planned` lists a run before it starts.
`finish` reads the step records and writes what the run added: claims, papers, findings new, rewritten,
unchanged or gone, and actions. `publish` writes the site's Run history without costs.

## Keeping a record of each step

Wrap any command in `step.mjs` and it writes a numbered folder with a `step.json` (times, exact command,
git commit, every input and output with its size, row count and checksum, models, number of calls, cost) and
appends one line to `ledger.jsonl`:

```sh
node pipeline/step.mjs --root $RUN --phase A --step 02-extract --in $RUN/prepare/pages.jsonl --out $RUN/A/02-extract \
  -- node pipeline/run.mjs --pages $RUN/prepare/pages.jsonl --out $RUN/A/02-extract --concurrency 10
```

`pipeline_summary.py` reads those records to build the Pipeline page's numbers.

## Organising the source PDFs

```sh
python3 pipeline/organize_raw.py $CORPUS /tmp/out [--batch DIR --batch-index INDEX.xlsx --batch-name NAME]
```

Gathers every PDF for the species (the intake's open-access downloads, the first run's supplied papers, and
any supplied batch with its spreadsheet index) into `raw/<species>/zh|en/`, named `year_author_title.pdf`,
keeps each paper once, and writes `raw/index.csv` with one row per PDF (bibliographic details, topic and
relevance from a batch index, origin, whether the pipeline has read it, page count, whether it needs OCR,
checksum, old location). Upload `raw/` to the dataset's top level.

## Publishing your corpus (optional)

```sh
HF_TOKEN=... python3 pipeline/hf_upload.py $CORPUS OWNER/NAME --site public/data/corpus.json
```

Uploads the species folder to a private Hugging Face dataset and writes the summary (names, counts and sizes,
never text) that the site's Corpus page reads. The dataset is private by default because the papers are
under many licences.

## If something goes wrong

- **A step stopped part-way:** run the same command again. `run.mjs`, `claimstage.mjs` and `cluster.mjs`
  skip what is already done.
- **`No endpoints found that can handle the requested parameters`:** the chosen model has no provider that
  supports every request option. Set `"provider": {"require_parameters": false}` for that step in
  `models.json`.
- **`unparsed output` on a few windows or claims:** the model's answer could not be read. They are listed
  and left out, not guessed at. Re-running retries them.
- **Tests fail after a change:** `npm test`. `npm run check` also checks the syntax of every script.

## What is not done yet

- No expert has audited the claims, so there are no measured error rates. `gold/README.md` describes the
  gold set to build for that.
- CNKI, Wanfang and CQVIP are not searched, and new papers are not discovered automatically.
- The site pages and the species profile (`../public/site-species.js`, `PROFILES`) are written for mandarin
  fish; a new species needs its own entry there.
