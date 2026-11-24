import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractRanking,runCases,boundedProcess } from "../src/specification/live-batch.mjs";
import { rankEnteroResults } from "../src/workflow/contracts.mjs";
const request="Холодильный шкаф 600 л";
const spec="case_id,category,request\nR01,refrigeration,"+request+"\nR02,refrigeration,Морозильный шкаф\n";
function events(){
  const input=JSON.parse(readFileSync(new URL("../docs/fixtures/synthetic-ranking-input.json",import.meta.url),"utf8"));
  Object.assign(input.request,{raw_request:request,site_id:"entero",clarification_required:false});
  const state={status:"completed",input:{request_json:JSON.stringify(input.request),research_json:JSON.stringify(input.research),candidates_json:JSON.stringify(input.candidates)},output:JSON.stringify(rankEnteroResults(input))};
  return [{type:"tool_use",sessionID:"fixture",part:{tool:"procurement_rank_offers",state}},{type:"step_finish",sessionID:"fixture",part:{reason:"stop"}}];
}
const stream=e=>e.map(x=>JSON.stringify(x)).join("\n");
test("extracts actual rank tool input and reranks independently",()=>{
 const result=extractRanking(stream(events()),request);assert.equal(result.ranked.primary.price_rub,90000);assert.equal(result.input.request.raw_request,request);
});
test("rejects model prose, missing terminal step, foreign request and altered rank result",()=>{
 assert.throws(()=>extractRanking('{"type":"text","sessionID":"fixture"}',request));
 assert.throws(()=>extractRanking(stream(events().slice(0,1)),request));
 assert.throws(()=>extractRanking(stream(events()),"Другой запрос"));
 const e=events();e[0].part.state.output="{}";assert.throws(()=>extractRanking(stream(e),request));
});
test("rejects duplicate rank calls, tool errors and mixed sessions",()=>{
 const e=events();assert.throws(()=>extractRanking(stream([e[0],...e]),request));
 const f=events();f.push({type:"error",sessionID:"fixture"});assert.throws(()=>extractRanking(stream(f),request));
 const g=events();g[1].sessionID="other";assert.throws(()=>extractRanking(stream(g),request));
});
test("batch defaults to one case and captures only operator-reviewable evidence",async()=>{
 const calls=[];const r=await runCases(spec,{execute:async(...args)=>{calls.push(args);return {status:"completed",stream:stream(events()),wall_seconds:1};}});
 assert.equal(calls.length,1);assert.deepEqual(calls[0][1].slice(0,5),["run","--agent","search-orchestrator","--format","json"]);assert.equal(r.cases[0].status,"ranked_unreviewed");assert.equal(r.evidence.length,1);assert.deepEqual(r.not_attempted,["R02"]);
});
test("failed process is not treated as no matching product and not retried",async()=>{
 let calls=0;const r=await runCases(spec,{limit:2,execute:async()=>{calls++;return {status:"timeout",wall_seconds:2};}});
 assert.equal(calls,2);assert.equal(r.evidence.length,0);assert.equal(r.cases[0].status,"timeout");
 await assert.rejects(runCases(spec,{limit:6}));
});
test("actual local subprocess succeeds without shell",async()=>{
 const r=await boundedProcess(process.execPath,["-e","console.log('fixture')"],{timeoutMs:3000});
 assert.equal(r.status,"completed");assert.equal(r.stream.trim(),"fixture");
});
test("actual subprocess timeout and output bounds fail closed",async()=>{
 const r=await boundedProcess(process.execPath,["-e","setTimeout(()=>{},10000)"],{timeoutMs:100});
 assert.equal(r.status,"timeout");
 const big=await boundedProcess(process.execPath,["-e","process.stdout.write('x'.repeat(2*1024*1024))"],{timeoutMs:3000});
 assert.equal(big.status,"output_limit");
});
