"""Operator-only XLSX import/export. No model, supplier or network calls."""
import argparse
import csv
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import zipfile

# Require defused XML parsing instead of the optional lxml implementation.
os.environ["OPENPYXL_LXML"] = "False"
os.environ["OPENPYXL_DEFUSEDXML"] = "True"
from openpyxl import Workbook, load_workbook
from openpyxl.xml import DEFUSEDXML

ROOT = Path(__file__).resolve().parents[1]
MAX_ARCHIVE = 2 * 1024 * 1024
MAX_UNCOMPRESSED = 12 * 1024 * 1024

def read_bounded(path, limit):
    with Path(path).open("rb") as stream:
        if not os.path.isfile(path):
            raise ValueError("Expected a regular file")
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError("File exceeds size limit")
    return data

def workbook_csv(data):
    if not DEFUSEDXML:
        raise RuntimeError("defusedxml must be active")
    if len(data) > MAX_ARCHIVE:
        raise ValueError("XLSX exceeds 2 MiB")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = archive.infolist()
        names = [m.filename for m in members]
        if len(members) > 128 or len(set(names)) != len(names):
            raise ValueError("Invalid ZIP inventory")
        if sum(m.file_size for m in members) > MAX_UNCOMPRESSED:
            raise ValueError("Uncompressed XLSX exceeds limit")
        for member in members:
            name = member.filename.lower()
            if (name.startswith("/") or "\\" in name or ".." in name.split("/")
                    or member.flag_bits & 1 or "vbaproject" in name
                    or name.startswith(("xl/externallinks/", "xl/embeddings/", "xl/activex/"))):
                raise ValueError("Unsupported workbook component")
    book = load_workbook(io.BytesIO(data), read_only=False, data_only=False, keep_links=False)
    try:
        if len(book.worksheets) != 1 or len(book.sheetnames) != 1:
            raise ValueError("Expected exactly one worksheet")
        sheet = book.active
        if sheet.sheet_state != "visible" or sheet.merged_cells.ranges:
            raise ValueError("Hidden or merged worksheet is not supported")
        if sheet.max_row > 101 or sheet.max_column != 3:
            raise ValueError("Expected header and 1–100 rows with exactly 3 columns")
        output = io.StringIO(newline="")
        writer = csv.writer(output, lineterminator="\n")
        for number, row in enumerate(sheet.iter_rows(), 1):
            values = []
            for cell in row:
                if cell.data_type in ("f", "e") or cell.hyperlink:
                    raise ValueError(f"Formula, error or hyperlink at row {number}")
                if cell.value is not None and not isinstance(cell.value, str):
                    raise ValueError(f"Expected text cell at row {number}")
                values.append(cell.value or "")
            writer.writerow(values)
        return output.getvalue()
    finally:
        book.close()

def validate_xlsx(path):
    text = workbook_csv(read_bounded(path, MAX_ARCHIVE))
    code = (
        "import {parseSpecification} from './src/specification/intake.mjs';"
        "import {readFileSync} from 'node:fs';"
        "const r=parseSpecification(readFileSync(0,'utf8'));"
        "console.log(JSON.stringify(r)); if(!r.ok) process.exitCode=1;"
    )
    result = subprocess.run(["node", "--input-type=module", "-e", code], cwd=ROOT,
                            input=text, text=True, capture_output=True, timeout=15)
    if not result.stdout:
        raise ValueError("Specification validation failed")
    return json.loads(result.stdout)

def comparison_xlsx(path):
    # The existing Node export re-ranks the raw evidence and preserves rejection rows.
    result = subprocess.run(["node", str(ROOT / "src/specification/export.mjs"), str(Path(path).resolve())],
                            capture_output=True, timeout=15, check=True)
    rows = csv.reader(io.StringIO(result.stdout.decode("utf-8-sig")))
    book = Workbook()
    sheet = book.active
    sheet.title = "Comparison"
    for i, row in enumerate(rows, 1):
        for j, value in enumerate(row, 1):
            c = sheet.cell(i, j)
            if i > 1 and j == 5 and value.isascii() and value.isdigit():
                c.value = int(value)
            else:
                c.value = value
                c.data_type = "s"  # Never emit a spreadsheet formula.
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions
    for letter, width in {"A":18,"B":32,"C":48,"D":14,"E":15,"F":12,"G":22,
                          "H":45,"I":28,"J":40,"K":40,"L":40}.items():
        sheet.column_dimensions[letter].width = width
    from openpyxl.styles import Font, PatternFill
    for c in sheet[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="234B63")
    out = io.BytesIO()
    book.save(out)
    book.close()
    return out.getvalue()

def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)
    imp = sub.add_parser("import")
    imp.add_argument("source")
    exp = sub.add_parser("export")
    exp.add_argument("source")
    exp.add_argument("destination")
    args = p.parse_args()
    try:
        if args.command == "import":
            result = validate_xlsx(args.source)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0 if result["ok"] else 1
        if Path(args.destination).suffix.lower() != ".xlsx":
            raise ValueError("Destination must end in .xlsx")
        data = comparison_xlsx(args.source)
        with Path(args.destination).open("xb") as target:
            target.write(data)
        return 0
    except Exception as exc:
        print(f"XLSX operation failed: {type(exc).__name__}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
