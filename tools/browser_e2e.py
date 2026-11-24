"""Run against a disposable local workbench; never contact a provider."""
import io
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
import urllib.request

from playwright.sync_api import sync_playwright, expect
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
URL = "http://127.0.0.1:4173"

class BrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.proc = subprocess.Popen(["node", "src/workbench/server.mjs"], cwd=ROOT,
                                    env={**os.environ, "PORT":"4173"},
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.addClassCleanup(cls.stop_server)
        for _ in range(100):
            if cls.proc.poll() is not None:
                raise RuntimeError("Server exited")
            try:
                with urllib.request.urlopen(URL, timeout=1) as r:
                    if r.status == 200:
                        break
            except OSError:
                time.sleep(.1)
        else:
            raise RuntimeError("Server not ready")
        cls.pw = sync_playwright().start()
        cls.addClassCleanup(cls.pw.stop)
        cls.browser = cls.pw.chromium.launch()
        cls.addClassCleanup(cls.browser.close)

    @classmethod
    def stop_server(cls):
        cls.proc.terminate()
        try:
            cls.proc.wait(5)
        except subprocess.TimeoutExpired:
            cls.proc.kill()
            cls.proc.wait()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width":1280,"height":900}, accept_downloads=True)
        self.addCleanup(self.context.close)
        self.page = self.context.new_page()
        self.external = []
        def route(req):
            if req.request.url.startswith(URL + "/") or req.request.url == URL:
                req.continue_()
            else:
                self.external.append(req.request.url)
                req.abort()
        self.page.route("**/*", route)
        self.page.goto(URL)

    def tearDown(self):
        self.assertEqual(self.external, [])

    def compare_fixture(self):
        self.page.locator("#sample-rank").click()
        expect(self.page.locator("#rank-status")).to_contain_text("Синтетический пример")
        self.page.locator("#compare").click()
        expect(self.page.locator("#primary-count")).to_have_text("1")
        expect(self.page.locator("#download")).to_be_enabled()

    def test_specification_and_invalid_duplicate(self):
        self.page.locator("#sample-spec").click()
        expect(self.page.locator("#spec-status")).to_contain_text("Синтетический пример")
        self.page.locator("#validate").click()
        expect(self.page.locator("#spec-status")).to_contain_text("50")
        expect(self.page.locator("#spec-table tbody tr")).to_have_count(50)
        row = "R01,refrigeration,Холодильный шкаф"
        self.page.locator("#spec").fill("case_id,category,request\n"+row+"\n"+row)
        self.page.locator("#validate").click()
        expect(self.page.locator("#spec-status")).to_contain_text("Duplicate")
        expect(self.page.locator("#spec-table tbody tr")).to_have_count(0)

    def test_download_and_stale_result_reset(self):
        self.compare_fixture()
        with self.page.expect_download() as event:
            self.page.locator("#download").click()
        download = event.value
        self.assertEqual(download.suggested_filename, "comparison.csv")
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/"comparison.csv"
            download.save_as(path)
            self.assertIn("https://entero.ru/item/123", path.read_text(encoding="utf-8-sig"))
        self.page.locator("#ranking").fill("{}")
        expect(self.page.locator("#download")).to_be_disabled()
        expect(self.page.locator("#print")).to_be_disabled()

    def test_print_pdf_preserves_draft_warning_and_source(self):
        self.compare_fixture()
        expect(self.page.locator("#print")).to_be_enabled()
        pdf = self.page.pdf(prefer_css_page_size=True, print_background=True)
        self.assertTrue(pdf.startswith(b"%PDF"))
        content = "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(pdf)).pages)
        self.assertIn("ЧЕРНОВИК", content)
        self.assertIn("https://entero.ru/item/123", content)
        self.assertIn("Synthetic equipment A", content)
        self.assertNotIn("Контракт ranking input", content)
        out = os.getenv("E2E_ARTIFACT_DIR")
        if out:
            path = Path(out)
            path.mkdir(parents=True, exist_ok=True)
            (path/"synthetic-draft.pdf").write_bytes(pdf)
            self.page.screenshot(path=str(path/"workbench.png"),full_page=True)

    def test_mobile_layout(self):
        self.page.set_viewport_size({"width":390,"height":844})
        self.compare_fixture()
        self.assertLessEqual(self.page.evaluate("document.documentElement.scrollWidth"),391)

if __name__ == "__main__":
    unittest.main()
