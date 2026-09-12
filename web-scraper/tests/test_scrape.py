import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch


SCRIPT = Path(__file__).parents[1] / "scripts" / "scrape.py"
SPEC = importlib.util.spec_from_file_location("scrape", SCRIPT)
scrape = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
sys.modules[SPEC.name] = scrape
SPEC.loader.exec_module(scrape)


class FakeResponse:
    def __init__(self, text, markdown, status=200, url="https://final.example/", selectors=()):
        self.text = text
        self._markdown = markdown
        self.status = status
        self.url = url
        self.selectors = set(selectors)
        self.markdown_kwargs = None

    def markdown(self, **kwargs):
        self.markdown_kwargs = kwargs
        return self._markdown

    def css(self, selector):
        if selector == "title::text":
            return SimpleNamespace(get=lambda: "Example title")
        return [object()] if selector in self.selectors else []


def args(**overrides):
    values = dict(
        url="https://example.com", mode="auto", timeout=1000, min_content=20,
        selector=None, proxy=None, solve_cloudflare=False, pretty=False,
    )
    values.update(overrides)
    return SimpleNamespace(**values)


class ScrapeTests(TestCase):
    def test_http_success_stops_fallback(self):
        response = FakeResponse("<article>enough</article>", "# Title\n\nEnough useful content here.")
        with patch.object(scrape, "fetch_http", return_value=response), \
             patch.object(scrape, "fetch_dynamic") as dynamic:
            result = scrape.scrape(args())
        self.assertEqual(result.strategy, "http")
        self.assertIn("Enough useful", result.markdown)
        dynamic.assert_not_called()

    def test_spa_shell_falls_back_to_dynamic(self):
        shell = FakeResponse('<div id="__next"></div><script id="__NEXT_DATA__">{}</script>', "Wait")
        rendered = FakeResponse("<article>rendered</article>", "# Rendered\n\nFull JavaScript page content.")
        with patch.object(scrape, "fetch_http", return_value=shell), \
             patch.object(scrape, "fetch_dynamic", return_value=rendered), \
             patch.object(scrape, "fetch_stealth") as stealth:
            result = scrape.scrape(args())
        self.assertEqual(result.strategy, "dynamic")
        stealth.assert_not_called()

    def test_blocked_responses_reach_stealth(self):
        blocked = FakeResponse("Access denied captcha", "", status=403)
        solved = FakeResponse("<article>solved</article>", "# Solved\n\nProtected page content.")
        with patch.object(scrape, "fetch_http", return_value=blocked), \
             patch.object(scrape, "fetch_dynamic", return_value=blocked), \
             patch.object(scrape, "fetch_stealth", return_value=solved):
            result = scrape.scrape(args())
        self.assertEqual(result.strategy, "stealth")
        self.assertFalse(result.blocked)

    def test_incidental_captcha_word_is_not_a_block(self):
        article = FakeResponse(
            "<article>This long article discusses captcha research.</article>",
            "# Research\n\nThis long article discusses captcha research in detail.",
        )
        with patch.object(scrape, "fetch_http", return_value=article), \
             patch.object(scrape, "fetch_dynamic") as dynamic:
            result = scrape.scrape(args())
        self.assertFalse(result.blocked)
        self.assertEqual(result.strategy, "http")
        dynamic.assert_not_called()

    def test_forced_mode_does_not_fallback(self):
        short = FakeResponse("<div>short</div>", "Short")
        with patch.object(scrape, "fetch_http", return_value=short), \
             patch.object(scrape, "fetch_dynamic") as dynamic:
            result = scrape.scrape(args(mode="http"))
        self.assertEqual(result.strategy, "http")
        dynamic.assert_not_called()

    def test_article_selector_and_data_images_are_cleaned(self):
        response = FakeResponse(
            "<article>content</article>",
            "# Article\n\n![pixel](data:image/png;base64,AAAA)\n\nText",
            selectors={"article"},
        )
        markdown = scrape.to_markdown(response, None)
        self.assertEqual(response.markdown_kwargs, {"css_selector": "article"})
        self.assertNotIn("data:image", markdown)
