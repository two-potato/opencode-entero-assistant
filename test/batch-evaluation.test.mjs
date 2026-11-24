import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reviewBatch } from "../src/specification/batch.mjs";
import { scoreBenchmark } from "../src/evaluation/score.mjs";
const spec="case_id,category,request\nA1,refrigeration,Холодильный шкаф\nA2,thermal,Плита электрическая\n";
const evidence=JSON.parse(readFileSync(new URL("../docs/fixtures/synthetic-ranking-input.json",import.meta.url),"utf8"));
const header=readFileSync(new URL("../docs/evaluation-results.csv",import.meta.url),"utf8").trimEnd();
const row=(id,overrides={})=>{
 const fields=header.split(",");
 const defaults={case_id:id,git_revision:"a".repeat(40),model:"fixture",observed_at_utc:"2026-11-24T00:00:00Z",status:"accepted",manual_active_minutes:"10",assisted_active_minutes:"4",wall_seconds:"120",offers_total:"1",offers_verified:"1",offers_compliant:"1",claims_checkable:"4",claims_correct:"3",unsupported_claims:"0",correct_abstention:"false",input_tokens:"",output_tokens:"",cost_amount:"",cost_currency:"",evidence_reference:"fixture",review_notes:""};
 return fields.map(k=>({...defaults,...overrides})[k]).join(",");
};
test("batch retains missing cases and preserves ordering",()=>{
 const b=reviewBatch(spec,[{case_id:"A1",input:evidence}]);
 assert.deepEqual(b.counts,{ranked:1,no_accepted_offer:0,invalid_evidence:0,missing_evidence:1});assert.equal(b.cases[0].ranked.primary.price_rub,90000);assert.equal(b.verification,"OFFLINE_UNVERIFIED");
});
test("batch rejects duplicate and unknown evidence IDs",()=>{
 assert.throws(()=>reviewBatch(spec,[{case_id:"A1"},{case_id:"A1"}]));assert.throws(()=>reviewBatch(spec,[{case_id:"Z"}]));
});
test("batch separates invalid evidence and no accepted offer",()=>{
 const b=reviewBatch(spec,[{case_id:"A1",input:{}},{case_id:"A2",input:{...evidence,candidates:[]}}]);
 assert.equal(b.counts.invalid_evidence,1);assert.equal(b.counts.no_accepted_offer,1);
});
test("empty benchmark never fabricates accuracy, unsupported counts or time savings",()=>{
 const s=scoreBenchmark(spec,header+"\n");assert.equal(s.status,"NOT_RUN");assert.equal(s.attribute_accuracy.value,null);assert.equal(s.unsupported_claims,null);assert.equal(s.paired_time.saved_minutes,null);assert.equal(s.completion.value,0);
});
test("partial benchmark uses full denominator for completion and records paired time",()=>{
 const s=scoreBenchmark(spec,header+"\n"+row("A1")+"\n");
 assert.equal(s.status,"PARTIAL");assert.equal(s.completion.value,.5);assert.equal(s.attribute_accuracy.value,.75);assert.equal(s.paired_time.saved_minutes,6);assert.equal(s.unknown_cost_cases,1);
});
test("correct abstention counts but failed run cannot be a success",()=>{
 const s=scoreBenchmark(spec,header+"\n"+row("A1",{status:"abstained",offers_total:"0",offers_verified:"0",offers_compliant:"0",correct_abstention:"true"})+"\n"+row("A2",{status:"failed",offers_total:"0",offers_verified:"0",offers_compliant:"0"})+"\n");
 assert.equal(s.status,"ALL_CASES_RECORDED");assert.equal(s.completion.value,.5);assert.equal(s.source_coverage.value,null);
 assert.throws(()=>scoreBenchmark(spec,header+"\n"+row("A1",{status:"failed",correct_abstention:"true"})));
});
test("inconsistent counts and mixed revisions rejected",()=>{
 assert.throws(()=>scoreBenchmark(spec,header+"\n"+row("A1",{offers_verified:"2"})));
 assert.throws(()=>scoreBenchmark(spec,header+"\n"+row("A1")+"\n"+row("A2",{git_revision:"b".repeat(40)})));
 assert.throws(()=>scoreBenchmark(spec,header+"\n"+row("A1")+"\n"+row("A1")));
});
test("cost and latency preserve missing measurements and do not mix currencies",()=>{
 const s=scoreBenchmark(spec,header+"\n"+row("A1",{cost_amount:"0.25",cost_currency:"USD"})+"\n"+row("A2",{cost_amount:"20",cost_currency:"RUB",wall_seconds:"300"})+"\n");
 assert.equal(s.cost_by_currency.USD.amount,.25);assert.equal(s.cost_by_currency.RUB.amount,20);assert.equal(s.latency.median_seconds,210);assert.equal(s.latency.p95_seconds,300);
});
