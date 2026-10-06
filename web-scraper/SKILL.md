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
python web-scraper/scripts/scrape.py --url https://example.com --timeout 15000 --total-timeout 60000
```

Modes: `auto` (default), `http`, `dynamic`, `stealth`.

The output includes `markdown`, `strategy`, HTTP `status`, `blocked`, `elapsed_ms`, and `error`. An `error` can contain failures from earlier strategies even when a later fallback succeeded.

## Runtime limits (Linux)

- Always invoke `scripts/scrape.py` as a CLI; do not bypass its supervisor by calling the internal `scrape()` function.
- `--timeout` is a **per-operation timeout in milliseconds**, default `120000` (2 minutes). The HTTP backend receives seconds; browser backends receive milliseconds.
- `--total-timeout` is the **whole-job deadline in milliseconds**, default `600000` (10 minutes). It includes imports, HTTP/browser strategies, browser-lock waiting and browser cleanup. Bounded forced teardown can add up to 6 seconds; an outer execution timeout should allow this margin (e.g. at least 610 seconds with defaults). This budget is per URL invocation, not a deadline for a multi-page research task; give each page its own invocation and budget.
- The supervisor runs fetching in an isolated worker process group. On deadline or SIGINT/SIGTERM it terminates the group, escalates to SIGKILL when needed and reaps orphaned descendants. It also removes leftover group members on normal completion.
- Unexpected SIGKILL of the supervisor also kills the Python worker via Linux parent-death signaling. SIGKILL cannot run supervisor cleanup; this does not promise identical descendant cleanup to a normal interrupt.
- Browser calls are serialized per Unix user with a shared file lock. A killed worker releases its lock; queued calls remain subject to their own total deadline.
- stdout contains the result JSON. Our stderr strategy/browser-boundary events omit URLs, proxies and page contents; the SDK may also emit its own diagnostic logs. The last event helps distinguish lock waiting from an unfinished browser call (which includes SDK cleanup).
- Exit codes: `0` content extracted, `1` fetch/worker failure, `124` total deadline, `130` SIGINT, `143` SIGTERM; invalid CLI options return `2`.
- A protected site can still return blocked/no-content. Do not increase timeouts or repeatedly retry it indefinitely. A browser/SDK failure must not become a long-lived CPU loop.

Run regression checks with `python -m unittest discover -s web-scraper/tests -v`.

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
