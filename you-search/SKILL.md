---
name: you-search
description: >
  Search the web through the You.com MCP server. Keyless with the free profile;
  an optional API key switches to the authenticated profile. Returns titles,
  URLs, and snippets in the same formats as the other search skills, and works
  with smart-search --provider=you and --scrape enrichment.
---

# you-search

Web search via the You.com MCP `you-search` tool. No credentials required: the
skill calls `https://api.you.com/mcp?profile=free` by default. Set `YDC_API_KEY`
to use the authenticated profile instead.

## Usage

```bash
# Simple search (keyless)
bun you-search/search.js "your query"

# Limit results
bun you-search/search.js "PostgreSQL BRIN indexes" --limit=5

# Save JSON output to a file
bun you-search/search.js "Yandex Cloud API" --output=results.json --format=json

# Markdown output
bun you-search/search.js "AMD Zen 6" --format=markdown

# Inline site: filter
bun you-search/search.js "Psalm annotations site:psalm.dev"
```

Through the shared orchestrator, with optional scraping through web-scraper:

```bash
bun yandex-search/smart-search.js "AMD Zen 6" --provider=you
bun yandex-search/smart-search.js "AMD Zen 6" --provider=you --scrape --scrape-top=3
```

## Parameters

- **query** (required) — search query text; inline `site:`, `lang:`, `loc:` filters are supported
- **--limit N** — number of results (default: 10, max: 100)
- **--output FILE** — save results to a file
- **--format FORMAT** — output format: `json`, `text`, `markdown` (default: `text`)

## Setup

None required — the free profile is keyless.

Optional, to use the authenticated profile with the full You.com toolset:

```bash
export YDC_API_KEY="YOUR_YDC_API_KEY"
```

or create `you-search/config.json`:

```json
{
  "apiKey": "YOUR_YDC_API_KEY"
}
```

API keys are available at [you.com/platform/api-keys](https://you.com/platform/api-keys).

## Output format

Same as `yandex-search`: text by default, with `json` and `markdown` alternatives. JSON results carry `title`, `url`, `snippet`, and `domain` fields, so `--scrape` enrichment in smart-search works unchanged.

## OpenClaw integration

This skill can be called through the `exec` tool or wired into an existing web_search tool as an alternative provider, like the other skills in this repo.
