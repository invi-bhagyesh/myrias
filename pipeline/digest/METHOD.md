# Weekly digest: method

A weekly list of links to Chinese-language material on animal welfare: news, government notices,
association posts and papers. All animals are in scope: farmed (land and aquatic), laboratory,
companion and wild. For now the digest is links only, with titles as published. Short English
summaries come later and will be edited by a person before they go out.

- Collector: `pipeline/digest.mjs`
- Sources: `pipeline/digest/sources.json`
- Words used to keep and sort items: `pipeline/digest/terms.json`
- Output: `public/data/digest/<YYYY-MM-DD>.json` (one issue) and `public/data/digest/index.json`
- Site page: `#/digest` (`public/site-digest.js`)
- Tests: `tests/digest.test.mjs`

## Running it

```
node pipeline/digest.mjs                                   # the 7 days ending today
node pipeline/digest.mjs --from 2026-10-31 --to 2026-11-06 # a given week
node pipeline/digest.mjs --only cvma,moa-news --dry-run    # some sources, print only
```

A run takes about a minute and makes no model calls. It prints a summary and writes the issue file
and the index. Commit both files to publish the issue.

## The hard part: getting the material

Most Chinese welfare material is not behind an API. It sits on government and association websites,
national news sites, WeChat official accounts and paywalled databases. The design rests on four
rules.

**1. Prefer structured access, scrape last.** The order of preference for a source is:

1. a search API that returns JSON with dates (People's Daily site search, Europe PMC);
2. a feed or sitemap (none of the sources tried so far has a usable one);
3. a list page whose links carry a date, either in the URL (`t20261106_…` on the Ministry site) or
   in the text beside the link (`[ 2026-11-05 ]` on the veterinary association site);
4. a list page without dates, where the date is read from the article page itself, and only for
   items that already passed the word filter (ScienceNet).

Structured access breaks less often, carries real dates and is kinder to the site.

**2. Every source is declared, not coded.** A source is an entry in `sources.json`:

| Field | Meaning |
|---|---|
| `id`, `name_zh`, `name_en` | how the source is named in the issue |
| `kind` | `news`, `government`, `association` or `paper` (shown on each link) |
| `scope` | `general` for sources about everything; `agriculture` or `veterinary` for sources already about animals. Decides how strict the word filter is. |
| `access.type` | which reader to use: `people-search`, `europepmc` or `html-list` |
| `access.url` | the page or API |
| `access.link` | for `html-list`: a pattern that article links match |
| `access.title` | `attr` (the link's title attribute, falling back to its text) or `text` |
| `access.date_from_url` | a pattern with year, month and day groups (day optional) |
| `access.date_near` | look for a date in the text just after the link |
| `access.date_from_page` | if only the month is known, open the article to find the day |
| `access.encoding` | force a text encoding (otherwise the page's own, with GBK handled) |

Adding a site that lists articles with dates is usually one entry and no code. A site with a
different kind of API gets a new reader in `digest.mjs` (a function of about 20 lines).

**3. Every run reports on every source.** Each issue records, per source: `ok`, `empty` (read fine,
nothing in the week) or `failed` with the error. It also records how many items were read and how
many were kept. A site that blocks us, goes down or changes its layout shows up at once on the
digest page under "How this issue was collected". It does not quietly drop out. Two checks guard
against silent failure: a nearly empty page is reported as such, and a list page where no link
matches the pattern is reported as a layout change.

**4. Be a polite, named client.** One request at a time per site, at least a second apart, a
20-second timeout and one retry. The user agent names the project and links the repository. A bare
custom user agent got empty pages from the Ministry site. A Mozilla-compatible string that still
names the project works, so that is what we send. We read only public pages. We do not log in, and
we do not touch WeChat or paywalled databases.

## Keeping and sorting items

An item is kept when it is dated inside the week and its words say it is about animals and welfare.
The **title** decides. The search snippet (People's Daily only) can add an item to a lower tier, but
it cannot raise one.

| Tier | Rule | Kept from |
|---|---|---|
| Animal welfare | a strong welfare word in the title (动物福利, 屠宰, 疼痛, 断尾, 去势, 啄羽, welfare, slaughter, stunning …) and an animal in view | all sources |
| Stress, disease and handling | an animal and a broader word in the title (应激, 疫病, 运输, 密度, 热应激 …) | all sources |
| Mentions animal protection | no welfare word in the title, but the snippet has one | general sources only |
| Farming and veterinary news | an animal in the title, no welfare word | agriculture and veterinary sources only |

Papers (Europe PMC) must have a welfare word in the title. Searching abstracts brought in molecular
work on "stress" and breeding studies.

Some words are removed before matching because they contain an animal character by accident:
熊猫 (panda) is not 猫 (cat), and 牛市 (bull market) is not 牛 (cattle). The list is
`exclude` in `terms.json`. 散养 and 笼养 (free-range, caged) count only as context words. Most news
that uses them is about rural income, not welfare.

Duplicates are dropped by URL, and by title once spaces and punctuation are removed.

## Sources in the first issue (2026-11-06)

| Source | How | What it gave |
|---|---|---|
| People's Daily site search | JSON search API, 8 welfare keywords, 2 pages each | 114 read; mostly wildlife protection stories, in the "mentions" tier |
| Europe PMC | search API by POST: welfare and animal words, an author affiliation in China, first published in the week | 6 read, none with a welfare word in the title |
| Ministry of Agriculture: news | list page, date in URL | 2 farming items |
| Ministry of Agriculture: notices | list page, date in URL (links go to department folders) | newest notice was from September |
| Chinese Veterinary Medical Association | list page, date beside link | the draft cattle and sheep slaughter quality standards (the one welfare item) |
| ScienceNet news | list page, month in URL, day from article | nothing on animals this week |

The sources tried and not used are listed in `sources.json` under `not_used`, each with the reason.
They include the Ministry's fisheries and livestock bureau sites (time out from our servers),
Farmers' Daily (403), the animal welfare cooperation committee ICCAW (503), Xinhua search (405),
CNKI and Wanfang (paywalled, terms forbid scraping), WeChat official accounts (no open feed, terms
forbid scraping) and Crossref by journal (Chinese animal-science journals are mostly missing).

## Known gaps

- **WeChat** carries much of the timely welfare material (associations, companies, researchers).
  There is no open way in. The honest options are to ask organisations for their posts directly, or
  to have a person add links by hand to a weekly file the collector also reads.
- **Chinese journals.** CNKI and Wanfang hold most Chinese papers. Their tables of contents are
  sometimes public on the journal's own site; those can be added as `html-list` sources one by one.
- **Wildlife noise.** "动物保护" in People's Daily search brings many wildlife conservation stories.
  They stay in a separate tier. Whether conservation belongs in a welfare digest is an editorial call.
- **Our servers' location.** Several Chinese government sites time out from outside China. Running
  the collector from a machine in China would open them.

## Next steps

1. Summaries: one or two English lines per kept item, written by a model and edited by a person
   before an issue is published. Titles stay as published.
2. A hand-added links file for WeChat posts and anything else an editor finds.
3. More `html-list` sources: provincial agriculture departments, the Chinese Association of Animal
   Science and Veterinary Medicine (its pages carry no dates on the list, so it needs
   `date_from_page`), journal contents pages.
4. Run weekly on a schedule (GitHub Actions or a scheduled task), commit the issue, and later send
   it by email.
