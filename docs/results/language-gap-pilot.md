# Pilot: what Chinese research on mandarin fish adds to the English record

Status: preliminary, 2026-10-11. Automated pipeline with a non-expert spot-check. No fish-welfare
expert has reviewed these results yet.

## Question

For the welfare technologies and practices described in Chinese research on one farmed species, how
many have no direct evidence in English-language research on the same species? English-only
evidence reviews would miss those.

## Result

Mandarin fish (*Siniperca chuatsi*), 14 Chinese papers (1983–2025):

| | Interventions | |
|---|---|---|
| Found in the Chinese papers | **12** | from 81 of the 120 checked claims; the rest are research methods or background |
| No English evidence at all | **3** | malachite green, copper sulfate, dichlorvos (disease and parasite treatments) |
| Only related English evidence, not the same intervention | **4** | starvation before feed training; water temperature management, including against ISKNV; flowing-water rearing of eggs and fry; breeding for feed acceptance |
| Direct English evidence | **5** | feed training onto artificial diets; first feeding with live prey; stocking density; light control; polyculture |

**7 of 12 (58%) have no direct English evidence on the same intervention in the same species.**
Where both languages have evidence, the Chinese papers came first: by 4 years for feed training
(1997 vs 2001), 18 for stocking density, 25 for first feeding with live prey and 29 for light
control. Treat these lags as indicative only (see limits).

Before my review the model alone found 4 of 12 without direct English evidence. Every correction
went the same way: the model counted related English papers as matches (a temperature-and-immunity
study counted as temperature management, a malachite-green residue survey counted as treatment use).
So the fully automated figure understates the gap.

## Method (the framework)

1. **Chinese evidence.** The Myrias pipeline reads the full text of each paper, extracts claims with a
   verbatim Chinese quote checked by code against the page, has a second model from another lab
   confirm that the quote supports the claim, and keeps those about welfare technology (120 claims).
2. **Interventions.** Claims are mapped to 12 named interventions by fixed rules
   (`pipeline/gap/mandarin-fish.json`). Research techniques such as histology or infection routes
   are excluded.
3. **English search.** For each intervention, OpenAlex, Crossref and Europe PMC are searched for the
   species names with the intervention terms (692 candidate records, 325 distinct papers). Records must name the species;
   look-alike names such as the aquarium "green mandarin fish" (*Synchiropus*) are excluded by rule.
4. **Judging.** A model reads each English title and abstract: same intervention in this species
   (yes), related (partial), or not (no); and whether an outcome was measured.
5. **Review.** I checked every "yes" outside feed training and a sample of 12 feed-training "yes"
   matches, and recorded 7 corrections with reasons (`pipeline/gap/mandarin-fish.review.json`).
   Both the automated and reviewed counts are kept.

Code: `pipeline/gap.mjs`. Full table with every English title and DOI:
`docs/results/gap-mandarin-fish.json`. Cost of the English judging: about $0.15 across two runs.

## Limits

- **One species, 14 papers.** The 12 interventions are those these papers describe, not all that
  exist. The share should be re-measured on a larger corpus before it is generalised.
- **Age.** Most of the Chinese papers are from 1983–2007; most English matches are from 2014 onward.
  Some gaps reflect history: malachite green, for example, is banned for food fish in many countries,
  including China, and dichlorvos is an organophosphate insecticide. They still show what practice was, and the English literature mentions
  malachite green only as a residue problem. Older English papers are also less well indexed, which
  inflates the lags.
- **Abstracts only.** The English side is judged from titles and abstracts, and some records have
  no abstract.
- **No expert review.** The review was a spot-check by the project author. An expert check of the
  "no direct English evidence" cases is the next step.
- **Chinese side unaudited.** The Chinese claims passed automated checks only.

## What would make this a result

Repeat on 3–5 major Chinese farmed species (for example grass carp, large yellow croaker, Pacific
white shrimp), with an expert check of a sample of the English-side judgments. If the share of
interventions without English evidence stays near half, that is the headline finding.
