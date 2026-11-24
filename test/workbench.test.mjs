import test from "node:test";
import assert from "node:assert/strict";
import { createWorkbench } from "../src/workbench/server.mjs";

async function fixture(t){
  const server=createWorkbench();
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return "http://127.0.0.1:"+server.address().port;
}
test("serves local UI and assets with restrictive headers",async t=>{
  const base=await fixture(t), r=await fetch(base);
  assert.equal(r.status,200);assert.match(await r.text(),/Комплектация/);
  assert.match(r.headers.get("content-security-policy"),/default-src 'none'/);
  for(const path of ["/app.js","/styles.css","/fixtures/specification.csv"])assert.equal((await fetch(base+path)).status,200);
  assert.equal((await fetch(base+"/package.json")).status,404);
});
test("validates fifty fixture rows and refuses duplicate IDs",async t=>{
  const base=await fixture(t), csv=await (await fetch(base+"/fixtures/specification.csv")).text();
  const post=body=>fetch(base+"/api/specification",{method:"POST",headers:{"Content-Type":"text/csv"},body});
  const r=await post(csv);assert.equal(r.status,200);assert.equal((await r.json()).cases.length,50);
  const row="R1,refrigeration,Холодильный шкаф";
  const invalid=await post("case_id,category,request\n"+row+"\n"+row);
  assert.equal(invalid.status,422);assert.deepEqual((await invalid.json()).cases,[]);
});
test("ranks synthetic JSON and returns downloadable evidence with explicit offline status",async t=>{
  const base=await fixture(t), input=await (await fetch(base+"/fixtures/ranking.json")).text();
  const r=await fetch(base+"/api/comparison",{method:"POST",headers:{"Content-Type":"application/json"},body:input});
  assert.equal(r.status,200);const result=await r.json();
  assert.equal(result.verification,"OFFLINE_NOT_VERIFIED");assert.equal(result.ranked.primary.price_rub,90000);assert.match(result.csv,/shortfall/);
});
test("denies foreign origin and unsupported content type",async t=>{
  const base=await fixture(t);
  assert.equal((await fetch(base+"/api/specification",{method:"POST",headers:{"Origin":"https://example.com","Content-Type":"text/csv"},body:"x"})).status,403);
  assert.equal((await fetch(base+"/api/specification",{method:"POST",body:"x"})).status,415);
});
test("rejects malformed and oversized payloads",async t=>{
  const base=await fixture(t);
  assert.equal((await fetch(base+"/api/comparison",{method:"POST",headers:{"Content-Type":"application/json"},body:"{"})).status,422);
  assert.equal((await fetch(base+"/api/specification",{method:"POST",headers:{"Content-Type":"text/csv"},body:"x".repeat(262145)})).status,413);
});
