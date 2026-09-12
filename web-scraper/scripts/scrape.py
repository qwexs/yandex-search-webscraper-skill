#!/usr/bin/env python3
"""Fetch a web page and convert its rendered content to Markdown with Scrapling."""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import asdict, dataclass
from typing import Any, Callable

BLOCK_MARKERS = re.compile(
    r"captcha|cf-chl|challenge-platform|cloudflare ray id|access denied|"
    r"enable javascript and cookies|verify you are human|too many requests",
    re.IGNORECASE,
)
SPA_MARKERS = re.compile(
    r"__NEXT_DATA__|id=[\"'](?:root|app|__next)[\"']|"
    r"data-reactroot|ng-version|window\.__NUXT__",
    re.IGNORECASE,
)


@dataclass
class ScrapeResult:
    url: str
    final_url: str | None = None
    title: str | None = None
    markdown: str | None = None
    strategy: str | None = None
    status: int | None = None
    blocked: bool = False
    elapsed_ms: int = 0
    error: str | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch a URL through Scrapling and emit deterministic Markdown."
    )
    parser.add_argument("--url", required=True)
    parser.add_argument(
        "--mode", choices=("auto", "http", "dynamic", "stealth"), default="auto"
    )
    parser.add_argument("--timeout", type=int, default=30_000, help="Timeout in ms")
    parser.add_argument("--min-content", type=int, default=500)
    parser.add_argument("--selector", help="Optional CSS selector to convert")
    parser.add_argument("--proxy", help="Optional proxy URL")
    parser.add_argument("--solve-cloudflare", action="store_true")
    parser.add_argument("--pretty", action="store_true")
    return parser.parse_args()


def response_text(response: Any) -> str:
    return str(getattr(response, "text", "") or getattr(response, "body", "") or "")


def response_status(response: Any) -> int | None:
    value = getattr(response, "status", None) or getattr(response, "status_code", None)
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def response_url(response: Any, original: str) -> str:
    return str(getattr(response, "url", None) or original)


def response_title(response: Any) -> str | None:
    try:
        title = response.css("title::text").get()
        return title.strip() if title else None
    except Exception:
        return None


def to_markdown(response: Any, selector: str | None) -> str:
    kwargs = {"css_selector": selector} if selector else {"main_content_only": True}
    return str(response.markdown(**kwargs)).strip()


def looks_blocked(status: int | None, text: str) -> bool:
    return status in {401, 403, 407, 429, 503} or bool(BLOCK_MARKERS.search(text[:100_000]))


def needs_browser(text: str, markdown: str, min_content: int) -> bool:
    compact = re.sub(r"\s+", " ", markdown).strip()
    return len(compact) < min_content or (bool(SPA_MARKERS.search(text)) and len(compact) < min_content * 3)


def fetch_http(url: str, timeout: int, proxy: str | None) -> Any:
    from scrapling.fetchers import Fetcher

    kwargs: dict[str, Any] = {"timeout": timeout, "retries": 1}
    if proxy:
        kwargs["proxy"] = proxy
    return Fetcher.get(url, **kwargs)


def fetch_dynamic(url: str, timeout: int, proxy: str | None) -> Any:
    from scrapling.fetchers import DynamicFetcher

    kwargs: dict[str, Any] = {
        "headless": True,
        "timeout": timeout,
        "network_idle": True,
        "block_ads": True,
        "retries": 1,
    }
    if proxy:
        kwargs["proxy"] = proxy
    return DynamicFetcher.fetch(url, **kwargs)


def fetch_stealth(
    url: str, timeout: int, proxy: str | None, solve_cloudflare: bool
) -> Any:
    from scrapling.fetchers import StealthyFetcher

    kwargs: dict[str, Any] = {
        "headless": True,
        "timeout": timeout,
        "network_idle": True,
        "block_ads": True,
        "solve_cloudflare": solve_cloudflare,
        "retries": 1,
    }
    if proxy:
        kwargs["proxy"] = proxy
    return StealthyFetcher.fetch(url, **kwargs)


def attempt(
    result: ScrapeResult,
    strategy: str,
    fetcher: Callable[[], Any],
    selector: str | None,
) -> tuple[Any, str, bool]:
    response = fetcher()
    text = response_text(response)
    status = response_status(response)
    blocked = looks_blocked(status, text)
    markdown = "" if blocked else to_markdown(response, selector)
    result.final_url = response_url(response, result.url)
    result.title = response_title(response)
    result.strategy = strategy
    result.status = status
    result.blocked = blocked
    result.markdown = markdown or None
    return response, text, blocked


def scrape(args: argparse.Namespace) -> ScrapeResult:
    started = time.perf_counter()
    result = ScrapeResult(url=args.url)
    errors: list[str] = []

    factories: dict[str, Callable[[], Any]] = {
        "http": lambda: fetch_http(args.url, args.timeout, args.proxy),
        "dynamic": lambda: fetch_dynamic(args.url, args.timeout, args.proxy),
        "stealth": lambda: fetch_stealth(
            args.url, args.timeout, args.proxy, args.solve_cloudflare
        ),
    }
    sequence = [args.mode] if args.mode != "auto" else ["http", "dynamic", "stealth"]

    for strategy in sequence:
        try:
            _, text, blocked = attempt(result, strategy, factories[strategy], args.selector)
            markdown = result.markdown or ""
            if args.mode != "auto":
                break
            if strategy == "http" and (blocked or needs_browser(text, markdown, args.min_content)):
                continue
            if strategy == "dynamic" and (blocked or len(markdown.strip()) < args.min_content):
                continue
            break
        except Exception as exc:
            errors.append(f"{strategy}: {exc}")

    if not result.markdown:
        result.error = "; ".join(errors) or "No readable content extracted"
    elif errors:
        result.error = "; ".join(errors)
    result.elapsed_ms = round((time.perf_counter() - started) * 1000)
    return result


def main() -> int:
    args = parse_args()
    try:
        result = scrape(args)
    except ModuleNotFoundError as exc:
        result = ScrapeResult(
            url=args.url,
            error=f"Missing dependency: {exc.name}. Install with: pip install 'scrapling[rag]'",
        )
    output = json.dumps(asdict(result), ensure_ascii=False, indent=2 if args.pretty else None)
    print(output)
    return 0 if result.markdown else 1


if __name__ == "__main__":
    sys.exit(main())
