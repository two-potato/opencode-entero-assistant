import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from openpyxl import Workbook, load_workbook
from xlsx_io import workbook_csv, validate_xlsx, comparison_xlsx, ROOT

def fixture(rows, extra_sheet=False):
    book = Workbook()
    ws = book.active
    for row in rows:
        ws.append(row)
    if extra_sheet:
        book.create_sheet("extra")
    out = io.BytesIO()
    book.save(out)
    book.close()
    return out.getvalue()

HEADER = ["case_id", "category", "request"]
ROW = ["R01", "refrigeration", "Холодильный шкаф, 600 л"]

class XlsxTests(unittest.TestCase):
    def test_import_uses_shared_csv_validator(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "spec.xlsx"
            p.write_bytes(fixture([HEADER, ROW]))
            self.assertEqual(validate_xlsx(p)["cases"][0]["request"], ROW[2])
            p.write_bytes(fixture([HEADER, ROW, ROW]))
            result = validate_xlsx(p)
            self.assertFalse(result["ok"])
            self.assertEqual(result["cases"], [])

    def test_formula_rejected(self):
        with self.assertRaises(ValueError):
            workbook_csv(fixture([HEADER, ["R01", "refrigeration", "=1+1"]]))

    def test_numeric_cells_rejected(self):
        with self.assertRaises(ValueError):
            workbook_csv(fixture([HEADER, [1, "refrigeration", ROW[2]]]))

    def test_extra_sheets_or_columns_rejected(self):
        for data in (fixture([HEADER, ROW], True), fixture([HEADER, ROW + ["extra"]])):
            with self.assertRaises(ValueError):
                workbook_csv(data)

    def test_bounds(self):
        with self.assertRaises(ValueError):
            workbook_csv(fixture([HEADER] + [ROW] * 101))
        with self.assertRaises(ValueError):
            workbook_csv(b"x" * (2 * 1024 * 1024 + 1))

    def test_external_parts_rejected(self):
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as archive:
            archive.writestr("xl/externalLinks/externalLink1.xml", "x")
        with self.assertRaises(ValueError):
            workbook_csv(out.getvalue())

    def test_comparison_preserves_source_and_numeric_price(self):
        path = ROOT / "docs/fixtures/synthetic-ranking-input.json"
        book = load_workbook(io.BytesIO(comparison_xlsx(path)), data_only=False)
        sheet = book.active
        self.assertEqual(sheet["E2"].value, 90000)
        self.assertEqual(sheet["H2"].value, "https://entero.ru/item/123")
        self.assertEqual(sheet["A3"].value, "shortfall")
        book.close()

    def test_export_does_not_emit_formulas(self):
        x = json.loads((ROOT / "docs/fixtures/synthetic-ranking-input.json").read_text())
        x["candidates"][0]["title"] = "=HYPERLINK(\"https://example.com/\",\"click\")"
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "input.json"
            p.write_text(json.dumps(x))
            book = load_workbook(io.BytesIO(comparison_xlsx(p)), data_only=False)
            self.assertEqual(book.active["C2"].data_type, "s")
            self.assertNotEqual(book.active["C2"].data_type, "f")
            book.close()

if __name__ == "__main__":
    unittest.main()
