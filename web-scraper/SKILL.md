---
name: web-scraper
description: >
  Fetch static, JavaScript-rendered, and protected web pages with Scrapling and
  return clean deterministic Markdown. Use for reading articles, extracting a
  URL, or enriching search results without an LLM.
---

# web-scraper

Fetch a URL through Scrapling and return JSON containing clean Markdown and diagnostics.

## Pipeline

In `auto` mode the scraper escalates only when needed:

1. `Fetcher` makes a fast browser-impersonating HTTP request.
2. `DynamicFetcher` renders JavaScript when the response is an SPA shell or has too little content.
3. `StealthyFetcher` handles blocking/challenge responses when the previous strategies fail.
4. Scrapling's deterministic `Response.markdown()` removes scripts, styles, hidden content, and boilerplate. No LLM is used.

## Usage

```bash
python web-scraper/scripts/scrape.py --url https://example.com --pretty
python web-scraper/scripts/scrape.py --url https://example.com --mode dynamic
python web-scraper/scripts/scrape.py --url https://example.com --mode stealth --solve-cloudflare
python web-scraper/scripts/scrape.py --url https://example.com --selector article
```

Modes: `auto` (default), `http`, `dynamic`, `stealth`.

The output includes `markdown`, `strategy`, HTTP `status`, `blocked`, `elapsed_ms`, and `error`. An `error` can contain failures from earlier strategies even when a later fallback succeeded.

## Installation

```bash
python -m pip install -r web-scraper/requirements.txt
scrapling install
```

`scrapling install` downloads browser binaries and system dependencies. Browser engines are required for `dynamic` and `stealth`, but no desktop UI is required.

## Operational notes

- Prefer `auto`; force a mode only for diagnosis or a known target.
- Add `--solve-cloudflare` only where Cloudflare challenges are expected.
- A proxy may be supplied with `--proxy`; Scrapling cannot repair poor IP reputation.
- Respect access controls, site terms, robots.txt, and rate limits.
