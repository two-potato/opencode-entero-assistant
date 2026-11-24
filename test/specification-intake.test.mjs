import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSpecification } from "../src/specification/intake.mjs";

const header = "case_id,category,request\n";
test("parses UTF-8 BOM, CRLF, commas and escaped quotes", () => {
  const result = parseSpecification('\uFEFF'+header.replace("\n","\r\n")+'R01,refrigeration,"Шкаф, ширина 700 мм, марка ""пример"""\r\n');
  assert.equal(result.ok, true);
  assert.equal(result.cases[0].request, 'Шкаф, ширина 700 мм, марка "пример"');
});
test("preserves quoted multiline requests", () => {
  const result = parseSpecification(header+'R01,refrigeration,"Шкаф холодильный\n220 В"');
  assert.equal(result.cases[0].request, "Шкаф холодильный\n220 В");
});
test("rejects duplicate ids and fails the whole batch", () => {
  const result = parseSpecification(header+"R01,refrigeration,Шкаф холодильный\nr01,refrigeration,Шкаф морозильный");
  assert.equal(result.ok,false); assert.deepEqual(result.cases,[]); assert.equal(result.errors[0].row,3);
});
test("rejects wrong headers and unclosed quotes", () => {
  assert.throws(()=>parseSpecification("id,request\nx,шкаф"));
  assert.throws(()=>parseSpecification(header+'R01,refrigeration,"unfinished'));
});
test("rejects invalid category, id and short request", () => {
  const result = parseSpecification(header+"../x,other,short");
  assert.equal(result.ok,false); assert.equal(result.errors.length,3);
});
test("rejects excessive rows or input bytes", () => {
  assert.throws(()=>parseSpecification(header+"R01,refrigeration,Шкаф холодильный\n".repeat(101)));
  assert.throws(()=>parseSpecification("x".repeat(262145)));
});
test("rejects extra columns and invalid characters after quote", () => {
  assert.equal(parseSpecification(header+"R01,refrigeration,Шкаф холодильный,extra").ok,false);
  assert.throws(()=>parseSpecification(header+'R01,refrigeration,"Шкаф холодильный"extra'));
});
test("benchmark contains 50 valid unique synthetic cases, balanced across categories", () => {
  const result = parseSpecification(readFileSync(new URL("../docs/benchmark-cases.csv",import.meta.url),"utf8"));
  assert.equal(result.ok,true); assert.equal(result.cases.length,50);
  const counts = {};
  for (const c of result.cases) counts[c.category]=(counts[c.category]||0)+1;
  assert.deepEqual(Object.values(counts),[10,10,10,10,10]);
});
