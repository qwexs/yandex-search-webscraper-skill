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
- Linux (process-group supervision and browser locking)
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

## Scraper runtime limits

Each URL runs in an isolated worker process group under a supervisor. The defaults are **2 minutes per operation** (`--timeout=120000`) and **10 minutes per URL invocation** (`--total-timeout=600000`), including browser startup, lock waiting and cleanup. A multi-page research task is not limited to 10 minutes overall.

```bash
python web-scraper/scripts/scrape.py --url https://example.com --timeout 120000 --total-timeout 600000
```

Both CLI values use milliseconds; the HTTP backend receives the appropriate value in seconds. Browser calls are serialized per Unix user. On timeout or SIGINT/SIGTERM, the supervisor terminates the worker group and reaps orphaned descendants, including a stuck browser cleanup. A timeout returns result JSON with exit code `124`; bounded teardown can add up to 6 seconds. Allow at least 610 seconds if an outer command runner also imposes a timeout.

Use the CLI entrypoint, not the internal `scrape()` function, to retain supervision. Unexpected SIGKILL of the supervisor kills the Python worker through Linux parent-death signaling, but cannot run the normal descendant-cleanup path. Operational stage events go to stderr; result JSON remains on stdout.

## Yandex configuration

Copy `yandex-search/config.example.json` to `yandex-search/config.json`, or set `YANDEX_SEARCH_API_KEY` and `YANDEX_FOLDER_ID`.

## Test

```bash
python -m unittest discover -s web-scraper/tests -v
```

With the dependencies installed, the suite covers fallback behavior, timeout units, a dead-dispatcher loop in the installed browser SDK, forced teardown, interruptions, browser-lock contention and orphaned descendants. Process regression tests do not access external sites or launch a real browser.

## License

MIT
