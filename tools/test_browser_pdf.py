import io
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.request

from playwright.sync_api import sync_playwright, expect
from pypdf import PdfReader
from pdf_review import ROOT, render_pdf, document_html, comparison_rows

class BrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        cls.url = f"http://127.0.0.1:{port}"
        cls.server = subprocess.Popen(["node","src/workbench/server.mjs"],cwd=ROOT,
                    env={**os.environ,"PORT":str(port)},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        cls.addClassCleanup(cls.stop_server)
        for _ in range(50):
            try:
                with urllib.request.urlopen(cls.url, timeout=1) as r:
                    if r.status == 200:
                        break
            except OSError:
                time.sleep(.1)
        else:
            raise RuntimeError("Workbench did not start")
        cls.p = sync_playwright().start()
        cls.addClassCleanup(cls.p.stop)
        cls.browser = cls.p.chromium.launch()
        cls.addClassCleanup(cls.browser.close)

    @classmethod
    def stop_server(cls):
        cls.server.terminate()
        try:
            cls.server.wait(timeout=3)
        except subprocess.TimeoutExpired:
            cls.server.kill()
            cls.server.wait()

    def page(self, width=1280, height=900):
        context = self.browser.new_context(viewport={"width":width,"height":height},accept_downloads=True)
        self.addCleanup(context.close)
        context.route("**/*",lambda route: route.continue_() if route.request.url.startswith(self.url+"/") else route.abort())
        page = context.new_page()
        page.goto(self.url)
        return page

    def sample_rank(self, page):
        page.locator("#sample-rank").click()
        expect(page.locator("#rank-status")).to_have_text("Синтетический пример загружен.")
        page.locator("#compare").click()
        expect(page.locator("#primary-count")).to_have_text("1")
        expect(page.locator("#download")).to_be_enabled()

    def test_full_browser_workflow_and_download(self):
        page = self.page()
        page.locator("#sample-spec").click()
        expect(page.locator("#spec-status")).to_have_text("Синтетический пример загружен.")
        page.locator("#validate").click()
        expect(page.locator("#spec-status")).to_have_text("Проверено позиций: 50")
        expect(page.locator("#spec-table tbody tr")).to_have_count(50)
        self.sample_rank(page)
        expect(page.locator("#offers")).to_contain_text("Synthetic equipment A")
        expect(page.locator("#rank-status")).to_contain_text("Источники не проверялись")
        with page.expect_download() as info:
            page.locator("#download").click()
        self.assertIn("https://entero.ru/item/123", Path(info.value.path()).read_text(encoding="utf-8-sig"))
        if os.environ.get("CI"):
            target = ROOT/"test-artifacts"
            target.mkdir(exist_ok=True)
            page.screenshot(path=str(target/"workbench.png"),full_page=True)
        page.locator("#ranking").fill("{}")
        expect(page.locator("#download")).to_be_disabled()
        page.locator("#compare").click()
        expect(page.locator("#rank-status")).to_have_text("Expected at most 100 candidates")

    def test_mobile_and_duplicate_rows(self):
        page = self.page(390,844)
        page.locator("#spec").fill("case_id,category,request\nR1,refrigeration,Холодильный шкаф\nR1,refrigeration,Холодильный шкаф")
        page.locator("#validate").click()
        expect(page.locator("#spec-status")).to_contain_text("Duplicate case_id")
        expect(page.locator("#spec-table tbody tr")).to_have_count(0)
        self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth"),390)

    def test_model_text_is_not_rendered_as_markup(self):
        page = self.page()
        source=json.loads((ROOT/"docs/fixtures/synthetic-ranking-input.json").read_text())
        source["candidates"][0]["title"]='<img src=x onerror=alert(1)>'
        page.locator("#ranking").fill(json.dumps(source))
        page.locator("#compare").click()
        expect(page.locator("#offers")).to_contain_text("<img src=x onerror=alert(1)>")
        expect(page.locator("#offers img")).to_have_count(0)

class PdfTests(unittest.TestCase):
    def test_rendered_pdf_contains_draft_source_price(self):
        source=ROOT/"docs/fixtures/synthetic-ranking-input.json"
        data=render_pdf(source)
        reader=PdfReader(io.BytesIO(data))
        text="\n".join(page.extract_text() for page in reader.pages)
        self.assertIn("ЧЕРНОВИК",text)
        self.assertIn("НЕ ОФЕРТА",text)
        self.assertIn("https://entero.ru/item/123",text)
        self.assertIn("90 000",text)
        self.assertIn("Synthetic equipment A",text)
        self.assertNotIn("/JavaScript",str(reader.trailer))
        if os.environ.get("CI"):
            target=ROOT/"test-artifacts"
            target.mkdir(exist_ok=True)
            (target/"synthetic-comparison.pdf").write_bytes(data)

    def test_pdf_escapes_untrusted_title_and_does_not_sum_alternatives(self):
        rows=comparison_rows(ROOT/"docs/fixtures/synthetic-ranking-input.json")
        rows[0]["title"]='<script>alert(1)</script>'
        html=document_html(rows)
        self.assertIn("&lt;script&gt;",html)
        self.assertNotIn("<script>",html)
        self.assertIn("Альтернативы не суммируются",html)
