"""Render a review-only procurement comparison PDF using local Chromium."""
import argparse
import csv
from html import escape
import io
from pathlib import Path
import subprocess
import sys

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 512 * 1024

def comparison_rows(source):
    path = Path(source).resolve()
    if not path.is_file() or path.stat().st_size > MAX_BYTES:
        raise ValueError("Expected bounded ranking JSON file")
    result = subprocess.run(
        ["node", str(ROOT / "src/specification/export.mjs"), str(path)],
        capture_output=True, check=True, timeout=15,
    )
    return list(csv.DictReader(io.StringIO(result.stdout.decode("utf-8-sig"))))

def document_html(rows):
    def txt(value):
        return escape(str(value or "—"), quote=True)
    offers = [r for r in rows if r["result"] in ("primary", "analog")]
    other = [r for r in rows if r["result"] not in ("primary", "analog")]
    parts = ["""<!doctype html><html lang="ru"><meta charset="utf-8">
    <style>@page{size:A4;margin:16mm 15mm 17mm}*{box-sizing:border-box}
    body{font:11px/1.5 Arial,"DejaVu Sans",sans-serif;color:#183342}
    h1{font-size:27px;line-height:1.2;margin:4px 0 12px}h2{font-size:16px}
    .eyebrow{letter-spacing:2px;color:#176b64;font-weight:bold}
    .notice{background:#fff3db;border:1px solid #e6cc9b;padding:12px;margin-bottom:20px}
    .offer{border-top:2px solid #176b64;padding:12px 0;break-inside:avoid}
    .price{font-size:19px;font-weight:bold;color:#176b64}
    .details{margin:8px 0;overflow-wrap:anywhere;white-space:pre-wrap}
    .label{font-weight:bold} .foot{color:#526873;font-size:10px}
    p,h2{overflow-wrap:anywhere} .excluded{border-top:1px solid #ccdeda;padding:8px 0}
    </style><body><div class="eyebrow">PROCUREMENT / REVIEW</div>
    <h1>Проект коммерческого сравнения</h1>
    <div class="notice"><b>ЧЕРНОВИК. НЕ ОФЕРТА.</b><br>
    Данные взяты из предоставленного файла, источники повторно не проверялись.
    Перед отправкой требуется проверка специалистом. НДС, количество, сроки поставки,
    доставка и условия оплаты не согласованы. Альтернативы не суммируются.</div>
    <h2>Варианты оборудования</h2>"""]
    if not offers:
        parts.append("<p>Нет принятого предложения.</p>")
    for i, r in enumerate(offers, 1):
        role = "Основной вариант" if r["result"] == "primary" else "Аналог"
        price = f'{int(r["price_rub"]):,}'.replace(",", " ")
        parts.append(f'<section class="offer"><div class="eyebrow">{i:02d} / {role}</div>'
            f'<h2>{txt(r["title"])}</h2><div class="price">{price} руб.</div>')
        for label, key in (("Наличие", "availability"), ("Источник", "source_url"),
                           ("Время из входных данных", "verified_at"),
                           ("Соответствие требованиям", "matched_constraints"),
                           ("Оговорки", "caveats"), ("Причина замены", "reason")):
            parts.append(f'<div class="details"><span class="label">{label}:</span> {txt(r[key])}</div>')
        parts.append("</section>")
    parts.append("<h2>Исключения и недостающие данные</h2>")
    for r in other:
        parts.append(f'<div class="excluded">{txt(r["result"])} · {txt(r["requested_model"])}'
                     f'<div class="details">{txt(r["reason"])}</div></div>')
    parts.append('<p class="foot">Локальный инструмент сравнения. Не подтверждает достоверность коммерческих данных.</p></body></html>')
    return "".join(parts)

def render_pdf(source):
    markup = document_html(comparison_rows(source))
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            context = browser.new_context(java_script_enabled=False, offline=True)
            context.route("**/*", lambda route: route.abort())
            page = context.new_page()
            page.set_content(markup)
            return page.pdf(format="A4", print_background=True, prefer_css_page_size=True,
                            display_header_footer=True, header_template="<span></span>",
                            footer_template='<div style="font-size:9px;color:#526873;width:100%;text-align:center">ЧЕРНОВИК · <span class="pageNumber"></span> / <span class="totalPages"></span></div>')
        finally:
            browser.close()

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("source")
    p.add_argument("destination")
    args = p.parse_args()
    try:
        if Path(args.destination).suffix.lower() != ".pdf":
            raise ValueError("Expected .pdf destination")
        data = render_pdf(args.source)
        with Path(args.destination).open("xb") as target:
            target.write(data)
        return 0
    except Exception as exc:
        print(f"PDF export failed: {type(exc).__name__}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
