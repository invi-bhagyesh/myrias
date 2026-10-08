# Myrias

An open, bilingual (English and Chinese), source-linked map of welfare technologies for farmed
aquatic animals. See `FRAMEWORK.md` for the plan: what is built, in what order, and why.

## The public site (`public/index.html`)

A static, read-only site that renders one data file, `public/data/release.json`:

- **Overview (front page):** one question, four live numbers (verified claims, sources,
  Chinese-language sources, species), three steps, a small picture of the map, what the site
  guarantees, and how to help check it. It makes no claims beyond what the data shows; in
  pre-release the numbers are zero and a note says why.
- **Explore:** a welfare problem x technology class matrix, filterable by species. Each cell is
  explicitly *has records*, *searched, nothing found* or *not searched yet*; none is left blank.
- **Species, sources and claims:** every claim shows a verbatim quotation, its location in the
  source, how it was verified and whether it was sampled in an expert audit.
- **Methods and limits:** how a run works, what "verified" means, measured error rates, models.
- **Download and cite:** JSON and CSV exports, a citation line, feedback links that open a
  pre-filled GitHub issue.
- English and Chinese interface (the Chinese text is a draft awaiting native-speaker review),
  light and dark mode, works on phones.

Status: pre-release. `release.json` holds the taxonomy and one species run in preparation; nothing
has been verified yet, and the site says so. The data format is in `docs/export-schema.md`.
`index.html?data=sample` loads clearly marked placeholder records so the layout can be tested.

## Staff workspace (`public/workspace.html`)

The earlier research desk: a local, browser-only tool for records, source files, prepared research
requests and result review. Its data stays in this browser (IndexedDB). It contains demo records,
is not part of the public evidence base, and is not linked from the site navigation.

## Development

```
npm run dev      # serves public/ at http://localhost:5173
npm run check    # JavaScript syntax
npm test         # export validation, matrix logic, CSV, bilingual string parity
```

No runtime dependencies or API keys. Tests check that a real release can contain only supported
or partly supported claims, that quotes and locators are present, that full text is never
published, and that English and Chinese strings stay in step.

## Deployment

GitHub Actions validates and deploys `public/` to GitHub Pages on pushes to `main`.

## Data and licensing

Source documents are licensed journal content and are never published here. Released records
contain bibliographic metadata, locators and short quotations only. The data licence is not set
yet and is shown as such on the download page.

Fonts: Space Grotesk and JetBrains Mono (SIL Open Font License 1.1), self-hosted in `public/fonts/`
so visiting the site makes no third-party requests. Visual style is inspired by ValueArena
(valuearena.github.io): warm paper background, forest-green accent, monospace labels, numbered sections.
