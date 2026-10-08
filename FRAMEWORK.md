# Myrias opportunity framework — v0.2 draft

Status: design draft, not yet implemented. Supersedes the local `framework-v0.1` used by
`research/sample-2026-09-17/run.py`. Open decisions are listed at the end.

## Purpose

Tell Myrias where to point capital and effort. The framework maintains a living map

```
Segment ──► Problem ──► Intervention ──► Opportunity ──► Decision
                 ▲             ▲               ▲
                 └──────── Claims (evidence with locators) ────────┘
```

and serves Myrias's **Identify** and **Validate** stages (see myrias.org/approach). Each
opportunity ends in one Myrias action: **invest**, **incubate**, **fund research** or **pilot**,
or an explicit **kill** with its reason.

It is not a literature summariser. Abstract-level summary cards are a commodity (one prompt over
OpenAlex produces them). Myrias's value is full-text, claim-level, bilingual evidence that is
verified and linked to decisions.

## Principles

1. **Claims, not summaries.** The atomic unit is a claim with a source locator. Summaries are
   views generated from claims, never stored as evidence.
2. **Append-only.** Nothing is overwritten. Every change is a new version with a reason, so any
   past decision can be reconstructed.
3. **Build on prior state.** Each run loads the current records and the latest decision, treats
   them as hypotheses, and records what changed and why. Runs never start from scratch.
4. **Generation and checking are separate.** Every LLM-produced claim is checked against its
   locator by a separate step before it can affect a score or decision.
5. **Bilingual from day one.** English and Chinese sources are first-class. Language is a field
   on every source and claim.
6. **No hidden arithmetic.** Scores are a profile with written bases, never a weighted average.
   Unknown stays `null` with a reason.
7. **Humans own the watch list and the decisions.** The AI drafts topics, queries and
   decisions; Myrias staff approve them.

## Records

All records carry `id`, `version`, `created_at`, `created_by` (person or run id) and
`supersedes` (previous version id or null).

| Record | Key fields |
|---|---|
| **Source** | `lang` (en/zh), title, original title, authors, venue, year, DOI/URL, `origin` (openalex/doaj/manual/…), `text_access` (metadata / abstract / partial / full), `license`, `family` (groups non-independent sources), content hash |
| **Claim** | `source_id`, `locator` (section, table, figure, page), `quote` (≤ 2 sentences, original language), `text_en`, `kind` (measured / inferred / speculative), `population`, `outcome`, `direction`, `magnitude` + unit (nullable), `verification` (unchecked / supported / unsupported / partial), `verified_by` |
| **Segment** | species, production system, life stage, geography, `animal_count` + basis + source, `as_of` |
| **Problem** | `segment_id`, welfare issue, severity, duration, prevalence (each value + basis or `null` + reason), claim ids |
| **Intervention** | name, mechanism, technology readiness (1–9 + basis), cost notes, claim ids |
| **Opportunity** | `intervention_id` × `segment_id`, score profile (below), proposed Myrias action, kill condition, claim ids |
| **Decision** | `opportunity_id`, status (`investigate` / `pilot_review` / `invest` / `incubate` / `fund_research` / `kill` / `insufficient_evidence`), rationale, reversal condition, next action + owner, what changed vs previous version |
| **Run** | job type, model + settings, prompt/template hash, input record ids, output record ids, tokens, cost, started/finished, status |

Affected animals are recorded **per population** (e.g. farmed fish, live-prey fish,
feed-input animals). Cross-species weighting assumptions are stored as named, swappable
parameters on the Opportunity, never baked into claims.

## Score profile (per Opportunity)

Myrias's four published criteria plus three:

| Dimension | Question |
|---|---|
| Reach | How many animals, in which populations? |
| Welfare gain | How much better per animal, on what endpoint? (direct outcome > validated proxy > mechanism) |
| Technology readiness | How close to deployable? |
| Market structure & business case | Who pays, who benefits, does it pay back? |
| Timing | Why now? |
| Myrias additionality | What happens without Myrias? |
| Uncertainty | Which unresolved facts would change the decision, and how would they be resolved? |

Each dimension: a value on a defined 0–1 scale with written anchor bands, or `null` + reason,
plus `basis` (claim ids) and `as_of`. Scale definitions live in `framework/scales.md`
(to be written; IAA's philosophy files are the reference if reuse is agreed).

## Pipeline

```
L1 Intake ─► L2 Extract ─► L3 Verify ─► L4 Map & screen ─► L5 Deep dive ─► L6 Decide
    ▲                                                                         │
    └──────────── new verified claims re-open only dependent records ◄────────┘
```

| Layer | Does | LLM role | Gate |
|---|---|---|---|
| **L1 Intake** | Daily fetch from the watch list (topics, journals, authors, EN + ZH queries) into SQLite. Sources: OpenAlex, DOAJ (Chinese OA journals), Wanfang/CNKI where licensed, manual uploads. | None | Dedupe by DOI / title hash; source-access policy |
| **L2 Extract** | Screen relevance, then extract claims with locators from full text where available, abstract otherwise (marked). | Extractor | JSON schema validation |
| **L3 Verify** | Check each claim against its quote and locator. Unsupported claims are stored but excluded from scoring. | Separate verifier (different prompt, ideally different model) | Claim status ≠ `unchecked` |
| **L4 Map & screen** | Attach claims to segments, problems, interventions. Cheap score profile for every Opportunity. | Drafts mappings and scores | Spot-check against staff rankings |
| **L5 Deep dive** | Top-ranked Opportunities only. Load prior state, reconcile, run strongest-case-against, identify evidence gaps. | Lead analyst + independent fresh auditor | Audit checklist passed |
| **L6 Decide** | Draft decision memo; staff approve, amend or reject. | Drafts memo | Human sign-off |

Intake is decoupled from LLM layers: ingestion keeps running when the model fails.

## Outputs

- Ranked opportunity list per sector, filterable by score dimension
- One-page decision memo per Opportunity (claims linked, kill condition, next action)
- Evidence-gap list → candidates for Myrias research funding
- Pilot specifications for `pilot_review` decisions
- Bilingual: memos in English, every claim keeps its original-language quote

## Operations

- Alert when no new sources arrive for N days (silent-failure check)
- Track ingested vs extracted vs verified counts (backlog metric)
- Monthly spot check of 20 random sources' metadata and 20 claims' verification
- Every run logs tokens and cost; report cost per verified claim

## Evaluation

The framework is evaluated on a frozen benchmark built from its own verified records:

| Task | Metric |
|---|---|
| Screening (source → relevant?) | recall, precision |
| Extraction (source → claims + locators) | claim F1, locator accuracy |
| Verification (claim → supported?) | accuracy |
| Decision (claims → status, ranking) | agreement with expert decisions, rank correlation |
| Update (timed source batches → revised decision) | update correctness, stability, cost |

Each task is run **English-only** and **English + Chinese**. Baselines: abstract-card pipeline
(title + abstract → 5-field JSON, as in "Instant Paper Radar"), long-context single pass,
RAG, translate-then-English pipeline. Ablations: no verification, no prior-state
reconciliation, no auditor. About 20% of labels double-annotated for agreement.

Research question for publication: does English-only LLM evidence synthesis miss
decision-relevant evidence on welfare interventions, and does a bilingual, claim-verified,
incremental knowledge base close that gap? Target: ACL / EMNLP via ARR, after real use
produces the data.

## Build order

1. **Schema + storage**: SQLite tables for the records above; export to JSON in Git.
2. **L1 intake** for aquaculture finfish (EN + ZH watch list drafted by AI, approved by staff).
3. **L2–L3** on the mandarin fish pellet transition (existing Myrias project). Replace
   `research/sample-2026-09-17/run.py`.
4. **L4–L6** for 4–6 aquaculture questions; first decision memos reviewed by staff.
5. Freeze benchmark split; run baselines; decide on paper.
6. Extend to crustaceans, then poultry and pigs on the same schema.

The browser workspace in `public/` stays as the reading and review interface; it will read
exported records instead of holding the canonical store.

## Open decisions

1. **Primary user**: investment team (deal decisions) or research team (evidence gaps)?
2. **Private data**: do internal notes and producer data enter the store? Determines hosting
   and access control.
3. **IAA methods**: is reuse of IAA's scales, schema or pipelines agreed, including for
   publication?
4. **Chinese full-text access**: which licensed channels (CNKI, Wanfang) are available, and
   what can be redistributed?
5. **Annotators**: who provides bilingual expert labels for the benchmark?
