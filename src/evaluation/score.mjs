import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseSpecification, csvRows } from "../specification/intake.mjs";

const HEADER="case_id,git_revision,model,observed_at_utc,status,manual_active_minutes,assisted_active_minutes,wall_seconds,offers_total,offers_verified,offers_compliant,claims_checkable,claims_correct,unsupported_claims,correct_abstention,input_tokens,output_tokens,cost_amount,cost_currency,evidence_reference,review_notes".split(",");
const STATUSES=new Set(["accepted","abstained","rejected","failed","unavailable"]);
function number(s,name,integer=false,optional=false){
  if(s===""&&optional)return null;
  if(!/^\d+(?:\.\d+)?$/.test(s))throw Error("Invalid "+name);
  const v=Number(s);
  if(!Number.isFinite(v)||v<0||v>Number.MAX_SAFE_INTEGER||(integer&&!Number.isSafeInteger(v)))throw Error("Invalid "+name);
  return v;
}
const ratio=(n,d)=>d===0?null:n/d;
const sum=a=>a.reduce((s,v)=>s+v,0);
function percentile(a,p){if(!a.length)return null;const sorted=[...a].sort((x,y)=>x-y);return sorted[Math.max(0,Math.ceil(p*sorted.length)-1)];}
function median(a){if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;}
export function scoreBenchmark(specification,reviewCsv){
  const spec=parseSpecification(specification);
  if(!spec.ok)throw Error("Invalid benchmark specification");
  if(typeof reviewCsv!=="string"||Buffer.byteLength(reviewCsv)>512*1024||reviewCsv.includes("\0"))throw Error("Invalid review CSV");
  const [header,...rows]=csvRows(reviewCsv);
  if(JSON.stringify(header)!==JSON.stringify(HEADER))throw Error("Invalid review header");
  const ids=new Set(spec.cases.map(c=>c.case_id)),seen=new Set(),reviewed=[];
  let revision=null,model=null;
  for(const row of rows){
    if(row.length!==HEADER.length)throw Error("Invalid review row width");
    const r=Object.fromEntries(HEADER.map((h,i)=>[h,row[i].trim()]));
    if(!ids.has(r.case_id)||seen.has(r.case_id))throw Error("Unknown or duplicate case ID");
    seen.add(r.case_id);
    if(!STATUSES.has(r.status)||!/^[a-f0-9]{40}$/.test(r.git_revision)||!r.model||
       !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(r.observed_at_utc)||
       !Number.isFinite(Date.parse(r.observed_at_utc))||!r.evidence_reference)throw Error("Missing or invalid review provenance");
    revision??=r.git_revision;model??=r.model;
    if(revision!==r.git_revision||model!==r.model)throw Error("Mixed revisions or models");
    for(const k of ["offers_total","offers_verified","offers_compliant","claims_checkable","claims_correct","unsupported_claims"])r[k]=number(r[k],k,true);
    if(r.offers_verified>r.offers_total||r.offers_compliant>r.offers_verified||r.claims_correct>r.claims_checkable)throw Error("Inconsistent review counts");
    if(!["true","false"].includes(r.correct_abstention))throw Error("Invalid abstention flag");
    r.correct_abstention=r.correct_abstention==="true";
    if(r.correct_abstention&&(r.status!=="abstained"||r.offers_total!==0))throw Error("Invalid correct abstention");
    if(r.status==="accepted"&&(r.offers_total===0||r.offers_compliant!==r.offers_total||r.unsupported_claims!==0))throw Error("Accepted case lacks compliant offers or has unsupported claims");
    if(r.status==="abstained"&&r.offers_total!==0)throw Error("Abstention contains offers");
    for(const k of ["manual_active_minutes","assisted_active_minutes","wall_seconds","cost_amount"])r[k]=number(r[k],k,false,true);
    for(const k of ["input_tokens","output_tokens"])r[k]=number(r[k],k,true,true);
    if((r.cost_amount!==null&&!/^[A-Z]{3}$/.test(r.cost_currency))||(r.cost_amount===null&&r.cost_currency))throw Error("Invalid cost currency");
    reviewed.push(r);
  }
  const total=spec.cases.length,counts={accepted:0,abstained:0,rejected:0,failed:0,unavailable:0};
  for(const r of reviewed)counts[r.status]++;
  const count=k=>sum(reviewed.map(r=>r[k]));
  const completed=counts.accepted+reviewed.filter(r=>r.correct_abstention).length;
  const walls=reviewed.map(r=>r.wall_seconds).filter(v=>v!==null);
  const pairs=reviewed.filter(r=>r.manual_active_minutes!==null&&r.assisted_active_minutes!==null);
  const costs=Object.create(null);
  for(const r of reviewed)if(r.cost_amount!==null){const c=costs[r.cost_currency]??={amount:0,cases:0};c.amount+=r.cost_amount;c.cases++;}
  return {status:reviewed.length===0?"NOT_RUN":reviewed.length===total?"ALL_CASES_RECORDED":"PARTIAL",revision,model,
    total_cases:total,reviewed_cases:reviewed.length,missing_cases:spec.cases.filter(c=>!seen.has(c.case_id)).map(c=>c.case_id),counts,
    completion:{numerator:completed,denominator:total,value:ratio(completed,total)},
    source_coverage:{numerator:count("offers_verified"),denominator:count("offers_total"),value:ratio(count("offers_verified"),count("offers_total"))},
    constraint_compliance:{numerator:count("offers_compliant"),denominator:count("offers_total"),value:ratio(count("offers_compliant"),count("offers_total"))},
    attribute_accuracy:{numerator:count("claims_correct"),denominator:count("claims_checkable"),value:ratio(count("claims_correct"),count("claims_checkable"))},
    unsupported_claims:reviewed.length?count("unsupported_claims"):null,
    latency:{observations:walls.length,median_seconds:median(walls),p95_seconds:percentile(walls,.95)},
    paired_time:{cases:pairs.length,manual_minutes:pairs.length?sum(pairs.map(r=>r.manual_active_minutes)):null,assisted_minutes:pairs.length?sum(pairs.map(r=>r.assisted_active_minutes)):null,saved_minutes:pairs.length?sum(pairs.map(r=>r.manual_active_minutes-r.assisted_active_minutes)):null},
    cost_by_currency:costs,unknown_cost_cases:reviewed.filter(r=>r.cost_amount===null).length,
    evidence_note:"Aggregates operator-reviewed records only; does not establish source truth."};
}
async function main(){
  if(process.argv.length!==4){console.error("Usage: node src/evaluation/score.mjs <benchmark.csv> <review.csv>");return 2;}
  try{
    const read=async(path,limit)=>{const s=await stat(path);if(!s.isFile()||s.size>limit)throw Error("Input limit");const b=await readFile(path);if(b.length>limit)throw Error("Input limit");return new TextDecoder("utf-8",{fatal:true}).decode(b);};
    const result=scoreBenchmark(await read(process.argv[2],256*1024),await read(process.argv[3],512*1024));
    console.log(JSON.stringify(result,null,2));return 0;
  }catch(e){console.error("Review validation failed: "+e.message);return 1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await main();
