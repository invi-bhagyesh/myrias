# Sources

What Myrias reads, where it searches, and what is planned. Status as of 2026-10-11.

## 1. In use

### Chinese corpus: mandarin fish (*Siniperca chuatsi*)

There are 14 papers, supplied as PDFs (manual upload). The full text is licensed, so it stays outside
the repository. Bibliographic details are in `pipeline/sources-meta.json`. A year marked † is a
received date or an approximation, not the printed publication year. English titles are informal
translations.

| Year | Title | English | Venue |
|---|---|---|---|
| 1983 | 鳜鱼人工繁殖及其养殖的研究 | Artificial breeding and culture of mandarin fish | not recorded |
| 1992 | 鳜鱼人工繁殖的生态生理学特性 | Eco-physiology of mandarin fish artificial breeding | 水生生物学报 16(1) |
| 1996 | 鳜鱼人工繁殖和夏花培育研究 | Artificial breeding and fry rearing | 淡水渔业 26(3) |
| 1996 | 鳜鱼口咽腔味蕾和行为反应特性及其对捕食习性的适应 | Taste buds, behaviour and adaptation to predation | 动物学报 42(1) |
| 1997† | 不同驯食方式对鳜鱼胃肠道消化酶活性的影响 | Feed-training methods and digestive enzymes | not recorded |
| 1998 | 用摄食条件反射研究鳜鱼食性的驯化 | Feed training by conditioned feeding reflex | 浙江农村技术师范专科学校学报 (1) |
| 1999 | 传染性脾肾坏死病毒(ISKNV)感染途径 | ISKNV infection routes | 中国病毒学 14(4) |
| 2000† | 鳜鱼病毒病原及细胞感染特性的研究 | Viral pathogens and cell infection | not recorded |
| 2001† | 鳜食性驯化的研究 | Feed training | not recorded |
| 2005† | 鳜鱼感官发育与摄食行为模式定向调控技术 | Sensory development and feeding-behaviour regulation | not recorded |
| 2005 | 鳜野生群体与养殖群体的RAPD分析 | RAPD analysis of wild and farmed populations | 大连水产学院学报 20(1) |
| 2006 | 鳜雌雄生长差异的研究 | Growth differences between sexes | 淡水渔业 36(3) |
| 2007† | 鳜鱼早繁新技术研究 | New techniques for early breeding | not recorded |
| 2025 | 鳜鱼生殖生长调控与良种培育技术研究进展 | Review: reproduction, growth regulation and breeding | 中山大学学报（自然科学版中英文）64(1) |

### English literature: language-gap search (`pipeline/gap.mjs`)

We search titles and abstracts only, through public APIs. Each query combines the species names
(*Siniperca chuatsi*, mandarin fish, Chinese perch, *Siniperca*) with each intervention's terms from
`pipeline/gap/mandarin-fish.json`. Here are the species-only searches:

| Source | Browser search | API used |
|---|---|---|
| OpenAlex | [openalex.org](https://openalex.org/works?search=Siniperca%20chuatsi) | [api.openalex.org](https://api.openalex.org/works?filter=title_and_abstract.search:%22Siniperca%20chuatsi%22) |
| Crossref | [search.crossref.org](https://search.crossref.org/search/works?q=Siniperca+chuatsi&from_ui=yes) | [api.crossref.org](https://api.crossref.org/works?query.bibliographic=Siniperca+chuatsi&rows=40) |
| Europe PMC (2,490 hits for the species) | [europepmc.org](https://europepmc.org/search?query=%22Siniperca%20chuatsi%22) | [REST API](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=%22Siniperca%20chuatsi%22&format=json) |

## 2. Planned, not yet used

| Source | Language | Search | Note |
|---|---|---|---|
| Springer Nature Link: *Fish Welfare Assessment in Aquaculture Systems* | EN | [topic](https://link.springer.com/search?query=*&dateFrom=&dateTo=&taxonomy=Fish+Welfare+Assessment+in+Aquaculture+Systems&sortBy=relevance) · [species](https://link.springer.com/search?query=Siniperca+chuatsi) | Topic seed for the welfare watch list; many papers are paywalled |
| DOAJ | EN/ZH | [API](https://doaj.org/api/search/articles/Siniperca%20chuatsi) | Open-access full text; listed for intake in `FRAMEWORK.md` |
| Wanfang Data 万方 | ZH | [鳜鱼](https://s.wanfangdata.com.cn/paper?q=%E9%B3%9C%E9%B1%BC) | Chinese journals and theses; full text needs a licence |
| CNKI 中国知网 | ZH | [鳜鱼](https://kns.cnki.net/kns8s/defaultresult/index?kw=%E9%B3%9C%E9%B1%BC) | Largest Chinese source; licence needed. This link could not be checked from our server. |
| CQVIP 维普 | ZH | [鳜鱼](https://www.cqvip.com/search?k=%E9%B3%9C%E9%B1%BC) | Older Chinese journals; full text needs a licence |

The open question for Chinese full text is which licence allows the text to be sent to model
providers (`FRAMEWORK.md`, open questions).
