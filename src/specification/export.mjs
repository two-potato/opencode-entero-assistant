import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { rankEnteroResults } from "../workflow/contracts.mjs";

const MAX_BYTES = 512 * 1024;
const HEADER = ["result","requested_model","title","item_id","price_rub","available","availability","source_url","verified_at","matched_constraints","caveats","reason"];

function cell(value) {
  if (value === null || value === undefined) return '""';
  if (typeof value === "number") return String(value);
  let text = String(value);
  // Treat external/model-provided strings as text, not spreadsheet formulas.
  if (/^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"','""') + '"';
}

export function comparisonCsv(input) {
  if (!Array.isArray(input?.candidates) || input.candidates.length > 100)
    throw new Error("Expected at most 100 candidate records");
  const ranked = rankEnteroResults(input);
  const rows = [HEADER];
  for (const offer of [ranked.primary, ...ranked.analogs].filter(Boolean)) {
    rows.push([offer.role,offer.requested_model,offer.title,offer.item_id,offer.price_rub,
      offer.available ? "yes" : "no",offer.availability,offer.url,offer.verified_at,
      offer.matched_constraints.join("; "),offer.caveats.join("; "),offer.promotion_reason ?? ""]);
  }
  for (const item of ranked.not_found) rows.push(["not_found",item.requested_model,"","","","","","","","","",item.reason]);
  for (const item of ranked.rejected) rows.push(["rejected",item.requested_model,"","","","","","","","","",item.reason]);
  if (!ranked.primary) rows.push(["no_offer","","","","","","","","","","","No accepted candidate in input"]);
  if (ranked.shortfall) rows.push(["shortfall","","","","","","","","","","",String(ranked.shortfall.missing)+" analog(s) missing"]);
  return "\uFEFF"+rows.map(row=>row.map(cell).join(",")).join("\r\n")+"\r\n";
}

async function main() {
  if (process.argv.length !== 3) { console.error("Usage: node src/specification/export.mjs <ranking-input.json>"); process.exitCode=2; return; }
  let file;
  try {
    file=await open(process.argv[2],"r");
    const info=await file.stat();
    if (!info.isFile() || info.size>MAX_BYTES) throw new Error("Expected regular JSON file up to 512 KiB");
    const buffer=Buffer.alloc(MAX_BYTES+1);
    let offset=0;
    while(offset<buffer.length) {
      const {bytesRead}=await file.read(buffer,offset,buffer.length-offset,null);
      if (!bytesRead) break;
      offset+=bytesRead;
    }
    if(offset>MAX_BYTES) throw new Error("JSON exceeds 512 KiB");
    const input=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(buffer.subarray(0,offset)));
    process.stdout.write(comparisonCsv(input));
  } catch(err) {
    console.error("Export failed: "+(err?.code ?? "invalid input"));
    process.exitCode=1;
  } finally { await file?.close(); }
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) await main();
