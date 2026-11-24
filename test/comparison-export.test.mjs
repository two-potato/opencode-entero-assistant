import assert from "node:assert/strict";
import test from "node:test";
import { comparisonCsv } from "../src/specification/export.mjs";
import { rankEnteroResults, validateResearchResult } from "../src/workflow/contracts.mjs";

function input() {
  return {
    request:{budget:{min:null,max:100000,currency:"RUB"}},
    research:{primary_model:{model:"Fixture A",search_query:"Fixture A",why:["Example"]},analogs:[],
      selection_criteria:[{name:"capacity",reason:"Example"}],
      sources:[{title:"Synthetic",url:"https://example.com/",supports:"Fixture only"}],
      research_caveats:["Synthetic shortage"]},
    candidates:[{requested_model:"Fixture A",role:"primary",status:"found",title:"Fixture A, test",
      item_id:"123",price_rub:90000,availability:"В наличии",available:true,url:"https://entero.ru/item/123",
      verified_at:"2026-11-24T00:00:00Z",matched_constraints:["capacity"],failed_constraints:[],caveats:[]}]
  };
}
test("exports ranked evidence and explicit analog shortage with Excel-compatible BOM",()=>{
  const csv=comparisonCsv(input());
  assert.ok(csv.startsWith('\uFEFF"result"'));
  assert.match(csv,/"primary","Fixture A","Fixture A, test","123",90000,"yes"/);
  assert.ok(csv.includes('"https://entero.ru/item/123"'));
  assert.ok(csv.includes('"2026-11-24T00:00:00Z"'));
  assert.ok(csv.includes('"shortfall"'));
});
test("does not export rejected candidate price or source",()=>{
  const x=input();x.candidates[0].price_rub=120000;
  const csv=comparisonCsv(x);
  assert.ok(csv.includes('"over_budget"')); assert.ok(csv.includes('"no_offer"'));
  assert.ok(!csv.includes("120000")); assert.ok(!csv.includes("https://entero.ru/item/123"));
});
test("quotes text and neutralizes spreadsheet formula prefixes",()=>{
  const x=input();x.candidates[0].title='=HYPERLINK("https://example.com/","click")';
  assert.ok(comparisonCsv(x).includes('"\'=HYPERLINK(""https://example.com/"",""click"")"'));
  x.candidates[0].title="@SUM(1,2)";
  assert.ok(comparisonCsv(x).includes('"\'@SUM(1,2)"'));
});
test("preserves missing result without fabricated offer",()=>{
  const x=input();x.candidates=[{requested_model:"Fixture A",role:"primary",status:"not_found",reason:"not in catalog"}];
  const csv=comparisonCsv(x);
  assert.ok(csv.includes('"not_found"')); assert.ok(csv.includes('"no_offer"')); assert.ok(!csv.includes("90000"));
});
test("rejects excessive batch input",()=>{const x=input();x.candidates=Array(101).fill(x.candidates[0]);assert.throws(()=>comparisonCsv(x));});
test("rejects non-RUB or reversed budget bounds",()=>{
  const x=input();x.request.budget.currency="USD";assert.throws(()=>rankEnteroResults(x),/RUB/);
  x.request.budget={min:100000,max:50000,currency:"RUB"};assert.throws(()=>rankEnteroResults(x),/minimum/);
});
test("rejects userinfo in supplier URL and research URL",()=>{
  const x=input();x.candidates[0].url="https://user:password@entero.ru/item/123";
  assert.equal(rankEnteroResults(x).primary,null);
  x.research.sources[0].url="https://user:password@example.com/";
  assert.throws(()=>validateResearchResult(x.research),/source URL/i);
});
