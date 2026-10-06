"""Real process regressions: deadlines, SDK spin, signals and descendant cleanup."""
import asyncio
import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock, patch

from test_scrape import SCRIPT, args, scrape


def supervised_args(**overrides):
    return args(total_timeout=overrides.pop("total_timeout", 500), **overrides)


def live(pid):
    try:
        return Path(f"/proc/{pid}/stat").read_text().split(") ", 1)[1].split()[0] != "Z"
    except FileNotFoundError:
        return False


class SupervisorTests(TestCase):
    def assert_tree_gone(self, pidfile):
        pids = [int(x) for x in pidfile.read_text().split()]
        for pid in pids:
            self.assertFalse(live(pid), f"Process {pid} survived cleanup")
            self.assertFalse(Path(f"/proc/{pid}").exists(), f"Zombie {pid} not reaped")

    def tree_worker(self, directory, *, finish=False):
        pidfile = Path(directory) / "pids"
        ready = Path(directory) / "child-ready"
        def run(_args):
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            child = subprocess.Popen([
                sys.executable, "-c",
                "import signal,time,pathlib,os; "
                "signal.signal(signal.SIGTERM,signal.SIG_IGN); "
                "pathlib.Path(__import__('sys').argv[1]).write_text(str(os.getpid())); "
                "time.sleep(60)", str(ready),
            ])
            pidfile.write_text(f"{os.getpid()} {child.pid}")
            until = time.monotonic() + 2
            while not ready.exists() and time.monotonic() < until:
                time.sleep(.01)
            if finish:
                return scrape.ScrapeResult(url=_args.url, markdown="complete", strategy="http")
            scrape.stage("stealth", "cleanup_fixture")
            while True:
                pass
        return run, pidfile, ready

    def test_timeout_kills_cpu_loop_and_sigterm_resistant_descendant(self):
        with tempfile.TemporaryDirectory() as directory:
            run, pidfile, ready = self.tree_worker(directory)
            started = time.monotonic()
            with patch.object(scrape, "scrape", side_effect=run):
                result, code = scrape.supervise(supervised_args())
            self.assertEqual(code, 124)
            self.assertEqual(result.strategy, "stealth")
            self.assertIn("cleanup_fixture", result.error)
            self.assertTrue(ready.exists(), "Fixture must reach its hung state")
            self.assertLess(time.monotonic() - started, 4)
            self.assert_tree_gone(pidfile)

    def test_success_also_cleans_orphaned_descendants(self):
        with tempfile.TemporaryDirectory() as directory:
            run, pidfile, ready = self.tree_worker(directory, finish=True)
            with patch.object(scrape, "scrape", side_effect=run):
                result, code = scrape.supervise(supervised_args(total_timeout=2000))
            self.assertEqual(code, 0)
            self.assertEqual(result.markdown, "complete")
            self.assertTrue(ready.exists())
            self.assert_tree_gone(pidfile)

    def test_sigterm_cleans_worker_and_descendant_and_restores_handler(self):
        with tempfile.TemporaryDirectory() as directory:
            run, pidfile, ready = self.tree_worker(directory)
            original = signal.getsignal(signal.SIGTERM)
            delivered = threading.Event()
            def send_signal():
                until = time.monotonic() + 3
                while not ready.exists() and time.monotonic() < until:
                    time.sleep(.01)
                if ready.exists():
                    os.kill(os.getpid(), signal.SIGTERM)
                    delivered.set()
            sender = threading.Thread(target=send_signal)
            sender.start()
            try:
                with patch.object(scrape, "scrape", side_effect=run):
                    result, code = scrape.supervise(supervised_args(total_timeout=5000))
            finally:
                sender.join(4)
            self.assertTrue(delivered.is_set())
            self.assertEqual(code, 143)
            self.assertIn("SIGTERM", result.error)
            self.assertEqual(signal.getsignal(signal.SIGTERM), original)
            self.assert_tree_gone(pidfile)

    def test_actual_patchright_dead_dispatcher_loop_is_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            reached = Path(directory) / "sdk-loop"
            def run(_args):
                from greenlet import greenlet
                from patchright._impl._sync_base import SyncBase
                loop = asyncio.new_event_loop()
                dead = greenlet(lambda: None)
                dead.switch()
                impl = SimpleNamespace(_loop=loop, _dispatcher_fiber=dead)
                reached.write_text(str(os.getpid()))
                scrape.stage("stealth", "dead_dispatcher_fixture")
                SyncBase(impl)._sync(asyncio.sleep(0))
            with patch.object(scrape, "scrape", side_effect=run):
                result, code = scrape.supervise(supervised_args(total_timeout=1500))
            self.assertTrue(reached.exists(), "Must exercise SDK loop, not import timeout")
            self.assertEqual(code, 124)
            self.assertIn("dead_dispatcher_fixture", result.error)
            self.assert_tree_gone(reached)

    def test_browser_lock_wait_is_inside_deadline_and_unlocks_after_kill(self):
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / "browser.lock"
            import fcntl
            with lock.open("w") as owner:
                fcntl.flock(owner.fileno(), fcntl.LOCK_EX)
                def run(_args):
                    # Don't keep the test owner's flock alive via fork inheritance.
                    os.close(owner.fileno())
                    with scrape.browser_slot("dynamic"):
                        return scrape.ScrapeResult(url=_args.url, markdown="acquired")
                with patch.object(scrape, "BROWSER_LOCK", lock), patch.object(scrape, "scrape", side_effect=run):
                    result, code = scrape.supervise(supervised_args(total_timeout=200))
                self.assertEqual(code, 124)
                self.assertIn("browser_lock_wait", result.error)
            with patch.object(scrape, "BROWSER_LOCK", lock):
                with scrape.browser_slot("dynamic"):
                    pass

    def test_worker_exits_if_supervisor_is_sigkilled(self):
        scrape.linux_prctl(36, 1)
        with tempfile.TemporaryDirectory() as directory:
            pidfile = Path(directory) / "worker-pid"
            program = '''
import importlib.util,sys,pathlib,time
from types import SimpleNamespace
s=importlib.util.spec_from_file_location('scrape',sys.argv[1]); m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m)
def hang(args):
 import os
 pathlib.Path(sys.argv[2]).write_text(str(os.getpid()))
 while True: pass
m.scrape=hang
m.supervise(SimpleNamespace(url='https://example.com',total_timeout=30000))
'''
            supervisor = subprocess.Popen([sys.executable, "-c", program, str(SCRIPT), str(pidfile)])
            child = None
            try:
                until = time.monotonic() + 3
                while not pidfile.exists() and time.monotonic() < until:
                    time.sleep(.01)
                self.assertTrue(pidfile.exists())
                child = int(pidfile.read_text())
                supervisor.kill()
                supervisor.wait(3)
                until = time.monotonic() + 3
                while live(child) and time.monotonic() < until:
                    time.sleep(.01)
                self.assertFalse(live(child))
                os.waitpid(child, 0)
            finally:
                if supervisor.poll() is None:
                    supervisor.kill()
                    supervisor.wait(3)
                if child and live(child):
                    os.kill(child, signal.SIGKILL)
                    os.waitpid(child, 0)

    def test_fetchers_use_seconds_for_http_and_milliseconds_for_browsers(self):
        http, dynamic, stealth = Mock(), Mock(), Mock()
        fake = SimpleNamespace(Fetcher=SimpleNamespace(get=http),
                               DynamicFetcher=SimpleNamespace(fetch=dynamic),
                               StealthyFetcher=SimpleNamespace(fetch=stealth))
        with tempfile.TemporaryDirectory() as directory, \
             patch.dict(sys.modules, {"scrapling.fetchers": fake}), \
             patch.object(scrape, "BROWSER_LOCK", Path(directory) / "browser.lock"):
            scrape.fetch_http("https://example.com", 30000, None)
            scrape.fetch_dynamic("https://example.com", 30000, None)
            scrape.fetch_stealth("https://example.com", 30000, None, False)
        self.assertEqual(http.call_args.kwargs["timeout"], 30)
        self.assertEqual(dynamic.call_args.kwargs["timeout"], 30000)
        self.assertEqual(stealth.call_args.kwargs["timeout"], 30000)

    def test_worker_failure_returns_structured_error(self):
        with patch.object(scrape, "scrape", side_effect=RuntimeError("fixture failure")):
            result, code = scrape.supervise(supervised_args())
        self.assertEqual(code, 1)
        self.assertIn("fixture failure", result.error)

    def test_nonpositive_cli_timeouts_are_rejected(self):
        for flag in ["--timeout", "--total-timeout"]:
            for value in ["0", "-1"]:
                with patch.object(sys, "argv", ["scrape.py", "--url", "https://example.com", flag, value]):
                    with self.assertRaises(SystemExit) as caught:
                        scrape.parse_args()
                    self.assertEqual(caught.exception.code, 2)
