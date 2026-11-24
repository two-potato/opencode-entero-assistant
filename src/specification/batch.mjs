import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseSpecification } from "./intake.mjs";
import { rankEnteroResults } from "../workflow/contracts.mjs";

export function reviewBatch(specification, records) {
  const spec=parseSpecification(specification);
  if(!spec.ok) throw new Error("Specification validation failed");
  if(!Array.isArray(records)||records.length>100)throw new Error("Expected at most 100 evidence records");
  const ids=new Set(spec.cases.map(c=>c.case_id));
  const byId=new Map();
  for(const record of records){
    if(!record||!ids.has(record.case_id)||byId.has(record.case_id))
      throw new Error("Unknown or duplicate evidence case ID");
    byId.set(record.case_id,record);
  }
  const cases=spec.cases.map(c=>{
    const record=byId.get(c.case_id);
    if(!record)return {...c,status:"missing_evidence"};
    try{
      if(!Array.isArray(record.input?.candidates)||record.input.candidates.length>100)
        throw new Error("Invalid candidate list");
      const ranked=rankEnteroResults(record.input);
      return {...c,status:ranked.primary?"ranked":"no_accepted_offer",ranked};
    }catch{return {...c,status:"invalid_evidence"};}
  });
  const counts={ranked:0,no_accepted_offer:0,invalid_evidence:0,missing_evidence:0};
  for(const c of cases)counts[c.status]++;
  return {verification:"OFFLINE_UNVERIFIED",association:"OPERATOR_SUPPLIED_CASE_IDS",total:cases.length,counts,cases};
}
async function main(){
  if(process.argv.length!==4){console.error("Usage: node src/specification/batch.mjs <spec.csv> <evidence.json>");return 2;}
  try{
    const read=async(path,limit)=>{const {open}=await import("node:fs/promises");const f=await open(path,"r");try{if(!(await f.stat()).isFile())throw Error();const buf=Buffer.alloc(limit+1);let pos=0;while(pos<buf.length){const {bytesRead}=await f.read(buf,pos,buf.length-pos,null);if(!bytesRead)break;pos+=bytesRead;}if(pos>limit)throw Error();return new TextDecoder("utf-8",{fatal:true}).decode(buf.subarray(0,pos));}finally{await f.close();}};
    const result=reviewBatch(await read(process.argv[2],256*1024),JSON.parse(await read(process.argv[3],4*1024*1024)));
    console.log(JSON.stringify(result,null,2));
    return result.counts.invalid_evidence||result.counts.missing_evidence?1:0;
  }catch{console.error("Batch input invalid");return 1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await main();
