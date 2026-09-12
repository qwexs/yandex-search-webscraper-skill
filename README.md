# yandex-search-webscraper-skill

Two companion OpenClaw skills:

- **`yandex-search/`** — localized web discovery through Yandex Search API.
- **`web-scraper/`** — static, JavaScript, and stealth fetching through Scrapling with deterministic Markdown output.

No LLM or Ollama service is involved.

## Pipeline

```text
Yandex Search API → ranked URLs
                    ↓ --scrape
Scrapling Fetcher (fast HTTP)
    ↓ SPA/low-content
DynamicFetcher (headless browser)
    ↓ blocked/challenge
StealthyFetcher
    ↓
Response.markdown() → clean Markdown + diagnostics
```

The browser fallbacks run headlessly and do not need a desktop UI. Browser binaries are still required for JavaScript rendering and stealth mode.

## Requirements

- Python 3.10+
- Bun (Yandex orchestration)
- Yandex Cloud Search API credentials

```bash
python -m pip install -r web-scraper/requirements.txt
scrapling install
```

## Quick start

```bash
python web-scraper/scripts/scrape.py --url https://example.com --pretty
bun yandex-search/smart-search.js "AMD Zen 6" --limit=5
bun yandex-search/smart-search.js "AMD Zen 6" --scrape --scrape-top=3
bun yandex-search/smart-search.js "query" --scrape --scrape-mode=dynamic
```

## Scraper output

```json
{
  "url": "https://example.com",
  "final_url": "https://example.com/",
  "title": "Example Domain",
  "markdown": "# Example Domain\n...",
  "strategy": "http",
  "status": 200,
  "blocked": false,
  "elapsed_ms": 318,
  "error": null
}
```

`auto` escalates from HTTP to a dynamic browser and finally stealth only when response quality or block detection requires it.

## Yandex configuration

Copy `yandex-search/config.example.json` to `yandex-search/config.json`, or set `YANDEX_SEARCH_API_KEY` and `YANDEX_FOLDER_ID`.

## Test

```bash
python -m unittest discover -s web-scraper/tests -v
```

## License

MIT
