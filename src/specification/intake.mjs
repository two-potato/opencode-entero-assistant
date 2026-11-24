import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LIMIT = 256 * 1024;
const HEADERS = ["case_id", "category", "request"];
const CATEGORIES = new Set(["refrigeration", "thermal", "bakery", "dishwashing", "small_equipment"]);

export function csvRows(input) {
  const text = input.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], cell = "", quoted = false, closed = false;
  const field = () => { row.push(cell); cell = ""; closed = false; };
  const end = () => { field(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === ",") field();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      end();
    } else if (c === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new Error("Invalid CSV quoting");
      cell += c;
    }
  }
  if (quoted) throw new Error("Unclosed quoted field");
  if (row.length || cell || closed) end();
  return rows;
}

export function parseSpecification(input) {
  if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > LIMIT || input.includes("\0"))
    throw new Error("Expected UTF-8 CSV text up to 256 KiB without NUL");
  const [header, ...rows] = csvRows(input);
  if (JSON.stringify(header) !== JSON.stringify(HEADERS))
    throw new Error("Expected exact header: case_id,category,request");
  if (rows.length < 1 || rows.length > 100) throw new Error("Expected 1–100 data rows");
  const ids = new Set(), errors = [], cases = [];
  rows.forEach((row, i) => {
    const number = i + 2;
    if (row.length !== 3) { errors.push({ row: number, reason: "Expected 3 fields" }); return; }
    const [id, category, request] = row.map(v => v.trim());
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) errors.push({ row: number, reason: "Invalid case_id" });
    else if (ids.has(id.toLowerCase())) errors.push({ row: number, reason: "Duplicate case_id" });
    ids.add(id.toLowerCase());
    if (!CATEGORIES.has(category)) errors.push({ row: number, reason: "Invalid category" });
    if (request.length < 10 || request.length > 2000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(request))
      errors.push({ row: number, reason: "Request must contain 10–2000 characters and no disallowed control characters" });
    cases.push({ case_id: id, category, request });
  });
  return errors.length ? { ok: false, errors, cases: [] } : { ok: true, errors: [], cases };
}

async function main() {
  if (process.argv.length !== 3) { console.error("Usage: node src/specification/intake.mjs <file.csv>"); process.exitCode = 2; return; }
  try {
    const info = await stat(process.argv[2]);
    if (!info.isFile() || info.size > LIMIT) throw new Error("Expected regular CSV file up to 256 KiB");
    const bytes = await readFile(process.argv[2]);
    if (bytes.length > LIMIT) throw new Error("CSV exceeds 256 KiB");
    const result = parseSpecification(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (err) {
    console.error(err instanceof Error ? err.message : "CSV validation failed");
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
