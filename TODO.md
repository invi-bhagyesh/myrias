# Next steps

Front end (done in this branch): public read-only site on a static JSON export, bilingual, with
sample data and tests.

## Needs the pipeline (not built yet)
- Generate `public/data/release.json` from the pipeline store at each release.
- First species run (mandarin fish) to replace the empty release with verified records.
- Methods page: real audit table, models and changelog come from `runs` in the export.

## Needs decisions or people
- Native-speaker review of the Chinese interface and taxonomy labels.
- Data licence for released records (shown as "to be set" on the download page).
- Replace the draft taxonomy once the first run shows what the corpus contains.
- Species images: none are shown now. Add only correctly identified, licensed photographs.
- Experts to audit samples of claims (bilingual, with fish-welfare knowledge).

## Site follow-ups
- Check the whole site with a screen reader and keyboard only.
- Shard the data file by species when it grows; add client-side search over claims.
- Add social-preview images and a favicon set.
- Decide whether the staff workspace moves out of `public/` or is retired.
