# Myrias research desk

An editorial-style aquaculture knowledge workspace, beginning with mandarin fish.

## Use

Run `npm run dev` and open http://localhost:5173. No runtime dependencies or API keys are required. `npm test` checks graph integrity and research-result boundaries; `npm run check` checks JavaScript syntax.

The interface supports knowledge records and directed relationships, source-file storage, prepared research requests, result review, and individual report PDF export through the browser print dialog.

All workspace content stays in this browser's IndexedDB. Export a backup from **Workspace** before clearing browser data. Backups contain the current workspace and original files; previous graph revisions can be downloaded separately from revision history. Private content is not uploaded. The Hugging Face dataset `invi-bhagyesh/myrias-knowledge-base` remains unconnected and uploads are paused.

## Research flow

1. Import sources or add citations. Attach extracted text for PDFs; this frontend does not extract PDF text.
2. Prepare a research question and select sources. Export the request JSON.
3. Execute the request using the research framework outside this static site. Its JSON packet includes the required result contract. The frontend does not call a model or run IAA automatically.
4. Import the result into the matching prepared request. Read the complete proposed record changes and report under Review.
5. Accept or reject. Acceptance requires the original graph revision to remain current and preserves the prior revision locally. A stale request must be prepared again. Graph updates support additions and replacements, not deletions or record-type changes.
6. Every imported completed result has its own report under Reports. Print/save PDF or download Markdown. KB snapshots format stored records without claiming new synthesis.

The initial public collection contains bibliographic leads and provisional questions, not measured welfare scores or a completed assessment. Source links are metadata; source bodies and private project documents are not bundled.

## Deployment

GitHub Actions validates and deploys `public/` to GitHub Pages on pushes to `main`. The separate repository provides `/myrias/` without modifying the personal-site repository.
