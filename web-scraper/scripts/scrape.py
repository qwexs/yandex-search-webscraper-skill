#!/usr/bin/env python3
"""Fetch a web page and convert its rendered content to Markdown with Scrapling."""

from __future__ import annotations

import argparse
import ctypes
import fcntl
import json
import multiprocessing
import os
import re
import signal
import sys
import tempfile
import time
from contextlib import contextmanager, suppress
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable

BLOCK_MARKERS = re.compile(
    r"cf-chl|challenge-platform|cloudflare ray id|cdn-cgi/challenge|"
    r"<title>\s*(?:just a moment|access denied|attention required)|"
    r"enable javascript and cookies to continue|verify you are human|"
    r"g-recaptcha|h-captcha|data-sitekey",
    re.IGNORECASE,
)
SPA_MARKERS = re.compile(
    r"__NEXT_DATA__|id=[\"'](?:root|app|__next)[\"']|"
    r"data-reactroot|ng-version|window\.__NUXT__",
    re.IGNORECASE,
)
CONTENT_SELECTORS = (
    "#mw-content-text",
    ".mw-parser-output",
    "article",
    "main",
    '[role="main"]',
    ".post-content",
    ".entry-content",
    ".article-content",
    ".article-body",
)
DATA_IMAGE = re.compile(r"!\[[^\]]*\]\(data:image/[^)]+\)", re.IGNORECASE)
STATUS_PATH: Path | None = None
BROWSER_LOCK = Path(tempfile.gettempdir()) / f"openclaw-web-scraper-{os.getuid()}" / "browser.lock"
SHUTDOWN_GRACE = 2.0


def positive_int(value: str) -> int:
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return number


def stage(strategy: str, phase: str, **details: Any) -> None:
    """Only operational metadata; never log URLs, proxies or page contents."""
    record = {"strategy": strategy, "phase": phase, **details}
    if STATUS_PATH is not None:
        temporary = STATUS_PATH.with_suffix(".tmp")
        temporary.write_text(json.dumps(record))
        temporary.replace(STATUS_PATH)
    with suppress(OSError):
        print(json.dumps(record), file=sys.stderr, flush=True)


@contextmanager
def browser_slot(strategy: str):
    """One browser worker per Unix user; queueing counts against total deadline."""
    BROWSER_LOCK.parent.mkdir(mode=0o700, exist_ok=True)
    fd = os.open(BROWSER_LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        stage(strategy, "browser_lock_wait")
        fcntl.flock(fd, fcntl.LOCK_EX)
        stage(strategy, "browser_lock_acquired")
        yield
    finally:
        os.close(fd)


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
    parser.add_argument("--timeout", type=positive_int, default=120_000, help="Per-operation timeout in ms")
    parser.add_argument("--total-timeout", type=positive_int, default=600_000,
                        help="Whole-job deadline in ms, including browser cleanup and lock wait")
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


def selector_exists(response: Any, selector: str) -> bool:
    try:
        return bool(response.css(selector))
    except Exception:
        return False


def clean_markdown(markdown: str) -> str:
    markdown = DATA_IMAGE.sub("", markdown)
    return re.sub(r"\n{3,}", "\n\n", markdown).strip()


def to_markdown(response: Any, selector: str | None) -> str:
    selected = selector or next(
        (candidate for candidate in CONTENT_SELECTORS if selector_exists(response, candidate)),
        None,
    )
    kwargs = {"css_selector": selected} if selected else {"main_content_only": True}
    return clean_markdown(str(response.markdown(**kwargs)))


def looks_blocked(status: int | None, text: str) -> bool:
    return status in {401, 403, 407, 429, 503} or bool(BLOCK_MARKERS.search(text[:50_000]))


def needs_browser(text: str, markdown: str, min_content: int) -> bool:
    compact = re.sub(r"\s+", " ", markdown).strip()
    return len(compact) < min_content or (bool(SPA_MARKERS.search(text)) and len(compact) < min_content * 3)


def fetch_http(url: str, timeout: int, proxy: str | None) -> Any:
    from scrapling.fetchers import Fetcher

    kwargs: dict[str, Any] = {"timeout": timeout / 1000, "retries": 1}
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
    with browser_slot("dynamic"):
        stage("dynamic", "browser_call")
        response = DynamicFetcher.fetch(url, **kwargs)
        stage("dynamic", "browser_closed")
        return response


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
    with browser_slot("stealth"):
        stage("stealth", "browser_call")
        response = StealthyFetcher.fetch(url, **kwargs)
        stage("stealth", "browser_closed")
        return response


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
        stage(strategy, "start")
        try:
            _, text, blocked = attempt(result, strategy, factories[strategy], args.selector)
            stage(strategy, "complete", status=result.status, blocked=blocked)
            markdown = result.markdown or ""
            if args.mode != "auto":
                break
            if strategy == "http" and (blocked or needs_browser(text, markdown, args.min_content)):
                continue
            if strategy == "dynamic" and (blocked or len(markdown.strip()) < args.min_content):
                continue
            break
        except Exception as exc:
            stage(strategy, "error", exception=type(exc).__name__)
            errors.append(f"{strategy}: {exc}")

    if not result.markdown:
        result.error = "; ".join(errors) or "No readable content extracted"
    elif errors:
        result.error = "; ".join(errors)
    result.elapsed_ms = round((time.perf_counter() - started) * 1000)
    return result


class ScrapeInterrupted(BaseException):
    def __init__(self, signum: int):
        self.signum = signum


def linux_prctl(option: int, value: int) -> None:
    """Use the existing Linux kernel, not a thread-based watchdog."""
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(option, value, 0, 0, 0) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


def worker(args: argparse.Namespace, result_path: Path, status_path: Path, parent_pid: int) -> None:
    global STATUS_PATH
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    signal.signal(signal.SIGTERM, signal.SIG_DFL)
    # A SIGKILL of the supervisor must not leave a spinning Python worker.
    linux_prctl(1, signal.SIGKILL)  # PR_SET_PDEATHSIG
    if os.getppid() != parent_pid:
        os._exit(1)
    os.setsid()
    STATUS_PATH = status_path
    try:
        result = scrape(args)
    except ModuleNotFoundError as exc:
        result = ScrapeResult(
            url=args.url,
            error=f"Missing dependency: {exc.name}. Install with: pip install 'scrapling[rag]'",
        )
    except Exception as exc:
        result = ScrapeResult(url=args.url, error=f"{type(exc).__name__}: {exc}")
    result_path.write_text(json.dumps(asdict(result), ensure_ascii=False))


def stop_group(process: multiprocessing.Process) -> None:
    """Clean descendants even when the worker itself already returned."""
    if process.pid is None:
        return
    pgid = process.pid
    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        # The supervisor may be interrupted before setsid() in worker bootstrap.
        if process.is_alive():
            process.terminate()
    process.join(SHUTDOWN_GRACE)
    with suppress(ProcessLookupError):
        os.killpg(pgid, signal.SIGKILL)
    if process.is_alive():
        process.kill()
    process.join(SHUTDOWN_GRACE)
    # PR_SET_CHILD_SUBREAPER adopts orphaned grandchildren. Reap only this group.
    deadline = time.monotonic() + SHUTDOWN_GRACE
    while time.monotonic() < deadline:
        try:
            pid, _ = os.waitpid(-pgid, os.WNOHANG)
        except ChildProcessError:
            break
        if pid == 0:
            time.sleep(0.01)


def supervise(args: argparse.Namespace) -> tuple[ScrapeResult, int]:
    """Parent never enters Scrapling/greenlet and can kill stuck C-level cleanup."""
    started = time.monotonic()
    result = ScrapeResult(url=args.url)
    exit_code = 1
    previous_handlers = {}

    def interrupt(signum: int, _frame: Any) -> None:
        raise ScrapeInterrupted(signum)

    linux_prctl(36, 1)  # PR_SET_CHILD_SUBREAPER
    with tempfile.TemporaryDirectory(prefix="web-scraper-") as directory:
        result_path = Path(directory) / "result.json"
        status_path = Path(directory) / "status.json"
        process = multiprocessing.get_context("fork").Process(
            target=worker, args=(args, result_path, status_path, os.getpid())
        )
        try:
            for sig in (signal.SIGINT, signal.SIGTERM):
                previous_handlers[sig] = signal.signal(sig, interrupt)
            process.start()
            remaining = max(0, args.total_timeout / 1000 - (time.monotonic() - started))
            process.join(remaining)
            if process.is_alive():
                result.error = f"Whole-job deadline exceeded ({args.total_timeout} ms)"
                exit_code = 124
            elif result_path.exists():
                try:
                    result = ScrapeResult(**json.loads(result_path.read_text()))
                    exit_code = 0 if result.markdown else 1
                except (OSError, ValueError, TypeError) as exc:
                    result.error = f"Invalid worker result: {type(exc).__name__}"
            else:
                result.error = f"Worker exited without a result (exit code {process.exitcode})"
        except ScrapeInterrupted as exc:
            result.error = f"Interrupted by {signal.Signals(exc.signum).name}"
            exit_code = 128 + exc.signum
        finally:
            # Ignore repeated interrupts while enforcing bounded teardown.
            for sig in previous_handlers:
                signal.signal(sig, signal.SIG_IGN)
            try:
                stop_group(process)
            finally:
                try:
                    process.close()
                finally:
                    for sig, handler in previous_handlers.items():
                        signal.signal(sig, handler)
        if result.strategy is None and status_path.exists():
            with suppress(OSError, ValueError):
                status = json.loads(status_path.read_text())
                result.strategy = status.get("strategy")
                if exit_code in (124, 130, 143):
                    result.error += f"; last stage: {status.get('phase', 'unknown')}"
    result.elapsed_ms = round((time.monotonic() - started) * 1000)
    return result, exit_code


def main() -> int:
    args = parse_args()
    result, exit_code = supervise(args)
    output = json.dumps(asdict(result), ensure_ascii=False, indent=2 if args.pretty else None)
    print(output)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
