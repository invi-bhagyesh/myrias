# Myrias welfare evidence framework — v0.3 draft

Status: design draft, October 2026. Not yet implemented. Replaces v0.2, which was written around
investment decisions. Supersedes the local `framework-v0.1` used by
`research/sample-2026-09-17/run.py`.

## 1. Aim

Help the communities whose decisions shape the welfare of farmed aquatic animals: producers and
extension workers, researchers (Chinese- and English-speaking), advocates and standard-setters.
The product is a verified, bilingual, openly released evidence base and the landscape view built
from it, not a financial or investment tool. Cost matters only as a barrier to adoption.

What it should make possible: someone deciding what practice to use, what to research, or what to
ask for in a standard can see what is known, how well supported it is, in which language it was
found, and what is missing.

## 2. Scope

- **Domain: aquaculture.** Finfish and decapod crustaceans first. Molluscs and other taxa later,
  each with a stated reason (sentience evidence differs).
- **First run: mandarin fish** (鳜鱼, *Siniperca chuatsi*), the live-prey to formulated-feed
  question, from the Chinese corpus described in section 9.
- **Proposed evaluation set** (three evidence profiles): Atlantic salmon (English-heavy, mature
  technology), mandarin fish or grass carp (Chinese-heavy), whiteleg shrimp (crustacean,
  eyestalk ablation).
- **Not in scope now:** land animals (poultry and pigs serve only as a maturity reference and for
  one small transfer test), financial scoring, a farmer-facing advice tool.

## 3. Two papers

| | **System paper** (first) | **Landscape paper** (culmination) |
|---|---|---|
| Question | Can a bilingual, claim-verified, incrementally updated pipeline build a trustworthy welfare evidence base, and how does it compare with simpler approaches? | What is the state of technology, including AI, for aquaculture welfare: how mature, with what evidence of welfare outcomes, and what is missing? |
| Content | Pipeline, evaluation, baselines, demo | Verified map: technology class x welfare problem x species x maturity x outcome evidence, with gaps and language provenance |
| Evidence it rests on | Audit of a bounded aquaculture subset | The exhaustive multi-run output, with each stage audited and error rates reported |
| Venue type | ACL system-demonstration or resource track | Journal or broad-audience venue; follow a scoping-review standard (PRISMA-ScR) |
| Timing | Next ACL demo deadline. The 2026 call's was 27 February 2026; confirm the 2027 call | After the full run and audit |

Rules: the landscape paper must stand alone for a welfare researcher; the two papers need
distinct contributions (check each venue's overlap policy); "exhaustive" is defined by protocol,
databases, dates, inclusion rules and a recall estimate, never claimed outright.

Parked: an evaluation of AI welfare advice (realistic farmer prompts, expert-labelled answers,
English/Chinese parity, overconfidence, omitted animals). Possible third paper once the system
exists.

## 4. Core model

**Run** = one species x one focus x one corpus snapshot. Each run builds on the records of earlier
runs and writes new versions; nothing is overwritten.

**Landscape** = a generated view over the latest verified records, stamped with an "as of" date and
version. It is not a separately maintained document.

Rules inherited from the design discussion:
- Evidence does not transfer between species. A shared technology is one record with
  species-specific entries; a link carries no evidence.
- Contradictions are recorded, never averaged. A later run may supersede a record, with a reason.
- Unsupported claims are stored but never scored or published.
- Absence is typed: *probed and empty* versus *not collected*. A gap in the landscape may be a gap in
  the corpus.

### Records

All records carry `id`, `version`, `created_at`, `created_by` (person or run id), `supersedes`.

| Record | Key fields |
|---|---|
| **Source** | `lang` (en/zh), title, authors, venue, year, DOI/URL, `origin`, `text_access` (metadata / abstract / partial / full), licence, `family` (non-independent sources), original hash, Markdown hash, converter + version |
| **Claim** | `source_id`, locator (page, char range), verbatim quote in original language (at most 2 sentences), English statement, `kind` (measured / reported_background / inferred / speculative), population (species, life stage, system), intervention, comparator, outcome, direction, magnitude + unit, `welfare_link` (direct / proxy / none) + bridge note, `verification` (unchecked / supported / partial / unsupported) |
| **Intervention** | technology class, mechanism, `maturity` (concept / research / pilot / commercial / widespread), claim ids |
| **Application** | intervention x species x system; `outcome_evidence` (none / detection only / welfare proxy improved / welfare outcome improved), populations affected, claim ids |
| **Problem** | species x system, welfare problem, severity / duration / prevalence each with basis or null + reason |
| **Run** | species, focus, corpus snapshot id, config, per-stage model + parameters, tokens, cost, counts, status, report |
| **Decision** (optional layer) | status, rationale, reversal condition, next action; for practice guidance, research gaps, standards asks, pilot designs |

Affected animals are recorded per population (target fish, live-prey fish, feed-input animals).
Cross-species weighting assumptions are named, swappable parameters, kept apart from evidence.

### Taxonomy (to refine; sketch only)
- **Welfare problems:** stocking density, water quality, handling and transport, stunning and
  slaughter, disease and parasites, feeding (including live prey), procedures such as eyestalk
  ablation.
- **Technology classes:** monitoring (cameras, acoustics, sensors), automation (feeding, grading),
  stunning equipment, breeding and genetics, vaccines and feeds, water treatment and recirculation.
- **AI uses:** computer vision for behaviour, stress and disease; acoustic analysis; predictive
  models.
Stable core with species extensions; changes are versioned.

### Assessment profile (optional, for guidance outputs)
Reach (animals affected), welfare gain, evidence strength, adoptability, backfire risk,
uncertainty (unresolved facts that would change the conclusion), neglectedness. Each is a defined
scale or null + reason, with basis and date. Never a single weighted score.

## 5. Pipeline

```
WATCH LIST  species · focus terms (EN + 中文) · journals · authors     (AI drafts, staff approve)
     │
L1  INTAKE      OpenAlex · DOAJ · Wanfang/CNKI where licensed · manual uploads · patents,
     │          standards, vendor pages → sources table (dedupe, language, access)   [no LLM]
L1b NORMALIZE   original → canonical Markdown + conversion report                    [no LLM]
     │
L2  PROFILE     what is in this corpus → proposed FOCUS        (human approval is a setting)
L3  SCREEN      relevance, source type, language                                      [LLM, cheaper]
L4  EXTRACT     claims with locator + verbatim quote + labels                         [LLM]
L5  VERIFY      deterministic quote check, then a separate LLM check                  [LLM, different prompt]
L6  MAP         taxonomy, maturity, outcome evidence                                  [LLM + rules]
L7  RECONCILE   against the current landscape: new / confirms / contradicts / supersedes
L8  GATES       expert audit sample · precision · recall estimate · saturation · gap probe
L9  COMMIT      append-only records + run report → landscape view regenerates
     └── later runs or new evidence re-open only dependent records
```

**Canonical Markdown (L1b).** Every source becomes one format before anything else reads it.
YAML front matter (source id, language, original hash, converter + version, pages), `<!-- page: N -->`
anchors, tables as Markdown tables, figures as captions only. A locator reads
`Z01 · p2 · chars 120-180`. The conversion report lists pages, characters, share of Chinese
characters, table count and warnings (no text layer, encoding quirks such as `⒚` standing for `。`).
Markdown derived from licensed text stays local and out of the repository.
Fidelity check: compare each Markdown file with its PDF text layer automatically, and have
auditors check a sample of claims against the original, because a quote matching the Markdown
only proves fidelity to the Markdown. Candidate converters (pymupdf4llm, MinerU, marker,
docling) are untested here; run two or three on the corpus and choose by measured fidelity and
table quality. Scanned files need an OCR path.

**Quote check (L5).** Normalise punctuation, spacing and known encoding substitutions, then require
the quote to appear on the cited page. Failures are labelled fabrication; claims supported by a
different source than the one cited are labelled misattribution (the split in arXiv 2601.22984).
Support that exists only in the other language needs a defined rule.

**Backend.** OpenRouter through one provider-agnostic interface. Model per stage set in config;
model, parameters and cost logged per run; hard per-run spend cap; option to restrict to providers
that do not retain data. `OPENROUTER_API_KEY` is present in the cloud environment; its validity and
credit are unchecked. Chinese-capable models should be compared as part of the evaluation.

**Reliability.** Intake never depends on the LLM. Alert when no new sources arrive for N days.
Track ingested versus extracted versus verified (backlog).

**Human points.** Watch list and focus; expert audit sample; sign-off before release.

## 6. Sizing and stopping rules

Corpus size is set by rules, not a target. A species-focus is done when all hold:
1. **Saturation:** the latest batch adds under a pre-set share (for example 2%) of new relevant
   claims or entries, and citation snowballing finds nothing new.
2. **Coverage:** every taxonomy cell has records or is marked probed-and-empty.
3. **Recall:** at or above a pre-set target (for example 90%) against an independent reference set
   (published reviews, known-relevant papers), with a confidence interval.

Audit sizes (95% confidence, n = z^2 p(1-p) / e^2): precision near 90% at +-5% needs about 140
claims; worst case (50%) needs about 385 at +-5% or about 1,070 at +-3%. Reporting by species group
and language separately needs about 140 per group; three groups x two languages is about 840
audited claims. A recall estimate of 90% +-5% needs about 140 known-relevant papers per group.
About 100-150 Chinese-language included sources per group gives the Chinese-only share to
roughly +-7-8%. The audit, not the corpus, is the binding limit.

Actual corpus sizes are unmeasured: the OpenAlex count probe was rate-limited and then stopped.
Planning assumption only: a few hundred included sources per species group.

## 7. Evaluation (system paper)

| Task | Metric |
|---|---|
| Conversion | fidelity to the PDF text layer; table recovery |
| Screening | recall, precision |
| Extraction | claim F1, locator accuracy |
| Verification | accuracy; fabrication vs misattribution rates |
| Mapping | agreement with experts on taxonomy, maturity, outcome evidence |
| Update | run-over-run incremental vs re-synthesis from scratch: cost, new vs duplicate claims, stability of earlier records |
| Language | share of claims and entries found only in Chinese; English-only vs bilingual coverage |

Baselines: abstract-card pipeline (title + abstract to a 5-field card, as in the "Instant Paper
Radar" article), long-context single pass, retrieval-augmented generation, an otto-SR/Elicit-style
LLM synthesis pipeline, translate-then-English. Ablations: no verification, no reconciliation, no
independent check. About 20% of labels double-annotated for agreement. Include one small transfer
test on a land-animal subset to answer the generalisation objection. Avoid circularity: use
independent references (published reviews) for recall and have experts review a sample that
includes items the system missed.

## 8. Related work and positioning

From four searches reading result summaries only; not a literature search. Check Web of Science,
CAB Abstracts and the Campbell and CEE registers before claiming novelty.

- **FishEthoBase / fair-fish database:** open species-profile database, ten criteria per species
  with certainty ratings (41 species in its 2019 paper); a taxonomy source and expert reference.
  Profile-level, not claim-level with locators. [PMC11496955](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11496955/)
- **Narrative reviews:** salmonid gap mapping ([Gaffney & Lavery 2021](https://www.frontiersin.org/articles/10.3389/fvets.2021.768558/pdf)),
  salmon welfare ([EcoEvoRxiv 2024](https://ecoevorxiv.org/repository/view/6960/)), welfare
  innovations (*Fishes* 2025). No protocol-driven map of aquaculture welfare interventions found.
- **Technology:** machine-vision welfare monitoring review (Fitzgerald et al. 2025,
  [Bristol](https://research-information.bris.ac.uk/en/publications/machine-vision-applications-for-welfare-monitoring-in-aquaculture/)):
  size and biomass estimation most developed; stress and disease detection lags; reported
  performance may be optimistic. A Chinese-university review covers vision for biomass and health
  ([Hainan](https://hndk.hainanu.edu.cn/en/article/cstr/32403.14.hndk.2025091502)). Vision only.
- **Welfare quantification:** [Welfare Footprint Institute](https://welfarefootprint.org/2024/06/25)
  and its [Atlas plan](https://forum.effectivealtruism.org/posts/SuXcALZ3hayWg6ckY/can-ai-power-the-global-mapping-and-quantification-of-animal);
  LLM use is a projection, not a built system. Possible collaborators.
- **LLM evidence synthesis (general):** [otto-SR](https://s4me.info/threads/automation-of-systematic-reviews-with-large-language-models-2025-bobrovitz-et-al.44631)
  (preprint, self-reported: screening sensitivity 96.7% vs 81.7%, extraction accuracy 93.1% vs
  79.7%), an [Elicit extraction test](https://ecoevorxiv.org/repository/object/9909/download/18365),
  a [2026 JMIR scoping review](https://www.jmir.org/2026/1/e81597/PDF) calling for more
  evaluation. None found applied to animal welfare or evaluated bilingually (claim about my
  searches, not a proven absence).
- **Deep-research failures worth testing here:** grounding split into fabrication and
  misattribution (arXiv 2601.22984); an English-only relevance rule in a scientific QA system's
  labelling prompt (Ai2 Scholar QA, ACL 2025 demo); reranker pools dominated by English and the
  query language (ACL 2026). A Cochrane result that excluding non-English studies changed 0 of 59
  conclusions failed verification as worded and needs a primary-source check; it is the main
  objection to the language claim. Choosing China-dominant species is the answer to it.

## 9. First run: the mandarin fish corpus

21 recovered PDFs (from a truncated 29 MB upload; one further file is damaged). Stored outside the
repository; the material is licensed journal content.

- 20 have a text layer; Z19 (vision series III) is a scan and needs OCR; the review on
  formulated-feed training and nutrition regulation (周良星) was cut off and needs re-uploading.
- From titles (not yet read): about 9 papers on feeding-habit domestication (驯食) and its
  sensory and behavioural basis, 5 on breeding, 3 on genetics and growth, 2 on disease, 2 general.
  Several look older (years such as 1997-2006 appeared; a 2025 mention appears in Z17); not checked.
- It supports the feed-training focus. It says nothing about technology or AI, and nothing is
  explicitly about welfare, so welfare must be inferred through proxies.
- It is Chinese-only: the English-versus-Chinese comparison needs a matching English corpus from
  intake on the same focus.

## 10. Risks and constraints

- **Licensing:** redistribution of Chinese full text is restricted; release metadata, locators and
  short quotes only. Check whether the licence allows sending text to a model provider.
- **Wrong guidance harms animals and people:** expert review before publication; uncertainty and
  local validity on every output; evidence kept separate from advice; an ethics section.
- **Livelihoods:** welfare guidance that ignores them will not be adopted; co-design with
  communities is needed.
- **Credibility of the landscape:** depends on audit quality; domain co-authors across species.
- **Model dependence:** results depend on the models used; log and compare.
- **Impact claims:** actual welfare outcomes are hard to attribute. Measure what is attributable:
  decisions in a practitioner task, uptake, documented case studies.
- **Human-subject studies** (farmers, extension workers) need ethics approval, including local
  approval in China; they are not on the system paper's critical path.

## 11. Build order

1. Normalize stage: compare converters on the corpus; define canonical Markdown; conversion report.
2. SQLite store and run table; deterministic quote checker.
3. Model-driven stages (profile, screen, extract, verify, map, reconcile) behind the OpenRouter
   interface with cost cap; run on the mandarin fish corpus; refine from measured error.
4. Matching English corpus for the same focus; first language comparison.
5. Expert audit design and sample; baselines; evaluation on the aquaculture subset; system paper.
6. Add species in stages with gap probes and audits; landscape paper.

## 12. Open decisions

1. Who audits (bilingual, with fish-welfare knowledge), and how many hours are available?
2. Licensed Chinese full-text access (CNKI, Wanfang) and what may be redistributed or sent to a
   provider.
3. Reuse of IAA's methods or schema, including for publication.
4. Re-upload of the truncated review; OCR for Z19.
5. Confirm the 2027 ACL demo-track dates; decide whether the landscape paper is aquaculture-only at
   first (recommended).
6. Corpus-size probe: retry OpenAlex counts (the first attempt was rate-limited).
7. Check the OpenRouter key's validity and credit; set the per-run spend cap.
