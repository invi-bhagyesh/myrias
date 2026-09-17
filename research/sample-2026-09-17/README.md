# Source-backed sample analyses — 17 September 2026

Two actual GPT-4o/OpenRouter calls apply the Myrias decision template to an analyst-curated public-source note packet. This is not a full automated IAA evaluation, systematic review, or independent expert assessment. The model receives bounded notes, not complete papers. Requests, responses, source notes and generation metadata are retained. No credentials are stored.

The mandarin-fish packet covers one controlled feeding study. The tilapia packet covers an on-farm protocol feasibility study and selected sections of a transport study. Access depth and limitations are recorded per source. Resulting PDFs are research deliverables; conclusions are not automatically accepted into the graph.

`build_reports.py` creates a static catalog, Markdown and printable HTML. PDFs are generated from this HTML with Chromium. The Reports tab exposes these static artifacts even for visitors with an existing local workspace. Existing illustrative reports and run history are preserved.

Interface testing remains deferred at the user's request. Report generation and source/provenance review are part of preparing the requested research artifact, not a UI verification round.

## Editorial corrections

Original model drafts are preserved as `<species>.md`; published reports use `<species>-final.md`. Codex removed unsupported claims about absent funding disclosure, attrition and study exclusions, distinguished study scope from the proposed commercial segment, and incorporated the transport evidence omitted from the tilapia draft. New research steps are explicitly analyst proposals. This is source-note fidelity editing, not independent expert review.
