# China animal welfare digest

The digest covers China-related animal welfare news, notices and research in any language.
A paper qualifies through an author affiliation in China (including Hong Kong and Macao),
or an explicit China mention in its title or abstract. The latter is labelled **China mentioned**:
it is a screening signal, not proof that a study took place in China. Human review is still needed.

Collection runs daily. The weekly issue contains links not listed in earlier issues, including
papers indexed after their original publication week. Titles remain as published. Original
publication dates, indexing dates when supplied, and first-discovery timestamps are separate.
There are no model calls, summaries or email delivery in this collector.

## Configuration

Sources live in `pipeline/digest/sources.json`; matching words and China-affiliation hints live in
`pipeline/digest/terms.json`. The collector supports `people-search`, `html-list`, `europepmc`,
`wanfang` and `openalex` readers. Set `enabled: false` on a source to disable it explicitly.

Add these **repository Actions secrets**, not entries in the JSON file:

| Secret | How to obtain it | Used for |
|---|---|---|
| `WFDATA_APP_KEY` | Sign in at [Wanfang AI Hub](https://ai.wfdata.com/), open Skills/API → My subscriptions, confirm literature search is enabled, then select Apply for App Key | Wanfang |
| `OPENALEX_API_KEY` | Create an [OpenAlex account and API key](https://openalex.org/settings/api) | OpenAlex cursor pagination and searches |

The registry's `access.key_env` names the environment variable. Missing keys produce an explicit
`skipped` status; they do not prevent the public sources from collecting. An invalid key, an
unavailable service or a malformed response produces `failed`, never a successful empty result.
Keys are sent in HTTPS headers and never stored in collection state or public issue files.

Wanfang's official API uses `POST /openwanfang/getQuery` with an `X-App-Key` header. We use its
HTTPS compatibility gateway, `https://api.wanfangdata.com.cn`, and the `OpenPeriodical` collection
without a language restriction. Pagination uses `start` and `rows`. Publication year bounds keep
the search manageable. Its public schema names `MetadataOnlineDate` but does not specify its date
format, so the first implementation retrieves the configured recent years and deduplicates them.
Only a valid full date is interpreted as a date. The authenticated gateway returns `numFound` as
a decimal string; the reader accepts that and numeric counts, rejecting malformed values. Validate
coverage with your subscribed account before adding online-date range filters. AI Hub currently
uses `/skill-api`; older `/skills/api` links may show a blank page. Literature search may already
be included in the account's default subscription. Check the displayed usage rates and wallet;
creating an AppKey does not itself guarantee free API usage.
See the [platform migration notice](https://open.wf.pub/docs/JSAPI) and
[official API schema](https://github.com/wanfangdata/wfdata-open-skills/blob/master/skills/wfdata-search/references/api-catalog.md).

Europe PMC searches `FIRST_IDATE`, its first indexing date, and requests `core` records so language,
affiliations and original publication dates are available. The query includes both Chinese
affiliations and China mentions. [Europe PMC API documentation](https://dev.europepmc.org/RestfulWebService).

OpenAlex searches titles and abstracts, running separate affiliation and China-text searches with
no language filter. Full-text-only and keyword-only matches are excluded from this discovery query.
Its default publication lookback is 90 days. `--backfill` widens that to 730 days; the scheduled job does this
on the first Saturday of each month. This reduces late-indexing gaps but does not guarantee that
arbitrarily old additions will be discovered. Update-date filters require a suitable subscription
and are not assumed here. [OpenAlex filters](https://help.openalex.org/api/filtering/).

OpenAlex searches that exceed 20 pages are divided into smaller, non-overlapping publication-date
ranges, down to individual days. Each range follows cursors; both China searches together are
limited to 400 requests per collection. Exceeding that budget or a single day's page limit is
reported as a failure and leaves the source watermark unchanged. This keeps the monthly backfill
complete without silently truncating it at 2,000 results. [OpenAlex pagination](https://help.openalex.org/api/paging/),
[search fields](https://help.openalex.org/api/searching/).

People's Daily uses the site's search endpoint. This worked in the November 2026 probe but is not
a documented public API contract. It searches targeted terms, paginates until results are older
than the collection window, and reports failure if the configured page ceiling is reached first.
The ministry, veterinary association and ScienceNet use public list pages. HTML readers remain
limited to the links currently on those lists; daily checks reduce, but cannot eliminate, gaps.
The journal RSS links investigated returned 404 and are not configured as working feeds.

## Local commands

Run from the repository root with Node 22 or newer. Provide credentials through environment
variables or your secret manager; do not commit them or paste them into issue descriptions.

```sh
# Collect through yesterday, using the Beijing calendar. Save state, without making an issue.
npm run digest:collect

# Build the completed Saturday–Friday issue from saved state. Existing issues are immutable.
npm run digest:weekly

# Inspect selected sources without writing anything.
node pipeline/digest.mjs --only europepmc-cn,people-search --collect-only --dry-run

# Fetch and build an explicit completed week, using isolated state and output.
node pipeline/digest.mjs --from 2026-10-31 --to 2026-11-06 \
  --state /tmp/myrias-digest/state.json --out /tmp/myrias-digest/issues

# Wider OpenAlex search for records indexed late.
node pipeline/digest.mjs --collect-only --backfill
```

`--sources PATH` supplies another registry. `--state PATH` and `--out PATH` isolate experiments
from the production checkpoint. `--only` is accepted only with `--collect-only` or `--dry-run`,
so a diagnostic source subset cannot publish an incomplete issue by accident. Dates must be valid
and end before the current Beijing day. The default combined command collects and then assembles
an issue; the workflow uses the separate commands above.

## State, duplication and failures

`pipeline/digest/state.json` is the durable checkpoint, created by the first successful run.
It contains bibliographic metadata, identity aliases, first/last discovery timestamps, the issue
that used each record, and each source's last successful date. It contains no abstracts, article
bodies, PDFs, credentials or model costs. Abstracts and affiliation text may be inspected in memory
for relevance, then discarded.

Deduplication uses normalized DOI, provider ID, URL and normalized title. Identity aliases persist
across runs and sources. Existing `public/data/digest/*.json` issues seed the checkpoint, so the
original issue is not repeated when upgrading. Matching translated titles without a common DOI
or provider identity is still imperfect.

Each source resumes at its last successful date with a two-day overlap. A failure never advances
that watermark. OpenAlex and Wanfang use their documented bounded search strategies above instead
of relying on publication dates as an incremental cursor. A paper with an unknown publication day
can be included based on discovery, with its date shown as unknown. Undated news is excluded.

If every attempted source fails or is unconfigured, the command exits unsuccessfully and writes
nothing. Partial success preserves the successful sources' discoveries and records coverage gaps.
The new issue is labelled partial if any configured source failed or was skipped. Publication
requires a successful collection through the issue end. Source-table counts distinguish the latest
scan from unique links included in the issue.

Issue files are never overwritten. Repeating publication for the same end date leaves new arrivals
queued for the next issue. JSON files use temporary-file replacement; after an interrupted issue
write, the next run imports that issue before assigning records again and rebuilds the index.
Do not delete the checkpoint to retry a source. Fix its configuration and rerun collection.

## GitHub schedule and publication

`.github/workflows/digest.yml` runs at **01:17 UTC / 09:17 Beijing daily** and supports manual runs.
Each run uses the latest `main` code, checks syntax and tests, restores saved collection data,
collects through yesterday, and assembles the most recent completed Friday if its issue is missing.
Thus Saturday normally creates the issue, while a delayed or missed run can catch up later.
GitHub schedules can be delayed; they run only once the workflow is on the default branch.
[GitHub schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

State and pending issues are saved on `automation/weekly-digest`, with concurrency control and an
explicit Git lease. The workflow reconstructs that automation branch from current `main`, retaining
its checkpoint and all unmerged issues. Existing issue files on `main` take precedence over restored
copies. The branch is exclusively machine-maintained; make editorial corrections on `main` through
a separate PR, not directly on the automation branch.

When issue data differs from `main`, the job opens one weekly PR or updates its existing branch.
Daily checkpoint changes alone do not open a PR. Review and squash-merge the weekly PR to publish;
the existing `pages.yml` workflow deploys it. If several weeks await review, their issues accumulate
in the same PR. There is no direct automated push to `main` and no automatic email.

Repository setup:

1. Add the two API secrets above; public sources work while either key is absent.
2. Allow GitHub Actions to create pull requests in Settings → Actions → General. Job permissions
   are limited to repository contents and pull requests.
3. Merge the implementation PR so the schedule is on `main`.
4. Run **Collect China welfare digest** manually once. Inspect its coverage summary and source
   statuses; verify Wanfang with the subscribed key before treating it as a complete source.
5. Review and merge generated weekly issues.

The workflow writes the checkpoint before attempting PR creation. If repository settings prevent
PR creation, the checkpoint remains on the automation branch and the job retries on the next run.
The Actions job summary lists missing keys and failures. A source that exceeds its pagination limit
fails visibly so its query can be narrowed or its limit raised; it is not silently truncated.

## Tests

`npm run check && npm test` covers the readers with injected responses, late-indexed papers,
China screening, language metadata, pagination errors, missing keys, retry behavior, persistent
cross-source identities, completed Beijing weeks, failed-run preservation, immutable reruns and
restoration of unmerged issues. Live API checks remain necessary when source contracts change.
