# How to rank the draft actions

This file is the spec the ranking model follows. Edit it to change what "priority" means, then run
`node pipeline/rank.mjs --release public/data/release.json`. Nothing else needs to change: the model
reads this text, ranks every action against it, and gives a reason for each place.

## Goal

Rank the actions by how much doing them would improve the welfare of the farmed fish, soon and at
scale, given what the evidence actually shows.

## What to weigh

Weigh these together as a careful fish-welfare expert would. They are not added up by a formula.

1. **Welfare gain.** How much suffering or harm the action would prevent: how severe the problem is
   (death, disease, chronic stress, injury), and how many fish it touches (every farm, or a niche case).
2. **Strength of evidence.** How many papers, whether the effect was measured or only described, and
   whether the papers agree. An action must not rank above what its findings support. One paper, or
   findings that only describe a practice, cannot carry an action to the top.
3. **Can it be done now.** Whether farmers, feed makers or vets could act on it this year with what they
   have, and what it costs them. A clear, cheap step ranks above one that needs new equipment or research.
4. **Risk if it is wrong.** What happens to the fish if the action turns out to be mistaken. Prefer
   actions whose downside is small.

## Rules

- Research actions can rank high only when the welfare gain at stake is large and the evidence gap is
  the main thing holding back a clear action.
- Do not reward an action for sounding specific; reward it for resting on measured, agreeing evidence.
- When two actions are close, place first the one backed by more measured claims from more papers.
