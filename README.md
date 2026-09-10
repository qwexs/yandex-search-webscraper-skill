# yandex-search-webscraper-skill

Two companion OpenClaw agent skills:

- **`yandex-search/`** — Web search via [Yandex Search API](https://yandex.cloud/ru/docs/search-api/). Auto-detects region (Cyrillic → RU, Latin → COM). Includes a `--scrape` flag that enriches results with full page content via the web-scraper skill.
- **`web-scraper/`** — Token-efficient HTML-to-Markdown conversion via local [Ollama](https://ollama.com) model (`Whyimhere/ReaderLM-v2`). Extracts the readable content of static-HTML pages. Auto-detects charset (UTF-8, windows-1251).

## Why these two together?

Yandex Search returns titles + short snippets. With `--scrape`, it fetches the full article content through the local Ollama model — bringing **10–40× fewer tokens** into your agent context compared to `web_fetch`.

```
Search result snippet: ~50 words
web_fetch full page:   ~5000–30000 tokens
web-scraper Markdown:  compact, content-focused output ✅
```

## Requirements

- [Bun](https://bun.sh) runtime
- [Ollama](https://ollama.com) running locally with model `Whyimhere/ReaderLM-v2:latest`
- Yandex Cloud account + Search API key (for yandex-search)

```bash
ollama pull Whyimhere/ReaderLM-v2
```

## Quick start

### Web scraper

```bash
bun web-scraper/scripts/scrape.js --url https://nvworld.ru/
```

```markdown
# МИР NVIDIA

Согласно новому слуху...
```

### Yandex search

```bash
# Basic search
bun yandex-search/search.js "AMD Zen 6" --limit=5 --format=json

# Smart search (auto region)
bun yandex-search/smart-search.js "AMD Zen 6 архитектура"

# Search + scrape full content of top 3 results
bun yandex-search/smart-search.js "AMD Zen 6" --scrape --scrape-top=3
```

## Setup (yandex-search)

```bash
cp yandex-search/config.example.json yandex-search/config.json
# Fill in apiKey and folderId
```

Get your API key via [Yandex Cloud CLI](https://yandex.cloud/ru/docs/search-api/):

```bash
yc iam service-account create --name search-bot
yc resource-manager folder add-access-binding $(yc config get folder-id) \
  --role search-api.webSearch.user --service-account-name search-bot
yc iam api-key create --service-account-name search-bot
```

## Skill parameters

### `web-scraper/scripts/scrape.js`

| Flag | Description |
|---|---|
| `--url <url>` | Target URL (required) |
| `--prompt <text>` | Custom HTML-to-Markdown prompt |
| `--no-retry` | Disable retry on failure |

### `yandex-search/smart-search.js`

| Flag | Description | Default |
|---|---|---|
| `--limit=N` | Number of results | 10 |
| `--format=FORMAT` | `text`, `json`, `markdown` | text |
| `--scrape` | Enrich results with full page content | — |
| `--scrape-top=N` | How many pages to scrape | 3 |

### `yandex-search/search.js`

| Flag | Description | Default |
|---|---|---|
| `--limit=N` | Number of results | 10 |
| `--format=FORMAT` | `text`, `json`, `markdown` | text |
| `--region=REGION` | `auto`, `ru`, `com`, `tr`, `ua` | auto |
| `--output=FILE` | Save to file | — |

## How it works

```
smart-search.js
  └─ search.js → Yandex API → URLs + snippets
  └─ (--scrape) scrape.js × N
       └─ fetch-html.js → fetch + charset decode + semantic extraction
       └─ extract.js → ReaderLM-v2 via Ollama → clean Markdown
```

`fetch-html.js` finds the main content block via semantic selectors (`<article>`, `<main>`, `#mw-content-text`, `.post-content`, etc.) before truncating — so Wikipedia, Habr, and similar sites work correctly.

## License

MIT
