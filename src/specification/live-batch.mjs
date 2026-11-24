import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { parseSpecification } from "./intake.mjs";
import { rankEnteroResults } from "../workflow/contracts.mjs";

const ROOT=fileURLToPath(new URL("../../",import.meta.url));
const MAX_OUTPUT=1024*1024;
const MAX_CASES=5;
const canonical=s=>typeof s==="string"?s.replace(/\s+/g," ").trim():null;

export function extractRanking(stream,request){
  const lines=stream.trim().split(/\r?\n/);
  const events=lines.map(l=>JSON.parse(l));
  if(!events.length||events.some(e=>!e||typeof e!=="object"||typeof e.sessionID!=="string"||e.type==="error"))
    throw Error("Incomplete or failed event stream");
  const sessions=new Set(events.map(e=>e.sessionID));
  if(sessions.size!==1)throw Error("Mixed sessions");
  const terminal=events.filter(e=>e.type==="step_finish").at(-1);
  if(terminal?.part?.reason!=="stop")throw Error("No successful terminal step");
  const calls=events.filter(e=>e.type==="tool_use"&&e.part?.tool==="procurement_rank_offers");
  if(calls.length!==1||calls[0].part.state?.status!=="completed")throw Error("Expected exactly one completed rank call");
  const state=calls[0].part.state;
  const args=state.input;
  if(!args||typeof args.request_json!=="string"||typeof args.research_json!=="string"||typeof args.candidates_json!=="string")throw Error("Invalid rank arguments");
  const input={request:JSON.parse(args.request_json),research:JSON.parse(args.research_json),candidates:JSON.parse(args.candidates_json)};
  if(canonical(input.request?.raw_request)!==canonical(request)||input.request?.clarification_required!==false||input.request?.site_id!=="entero")throw Error("Rank request does not match case");
  if(!Array.isArray(input.candidates)||input.candidates.length>100)throw Error("Invalid candidates");
  const ranked=rankEnteroResults(input);
  const reported=JSON.parse(state.output);
  // Compare actual structured tool output to a fresh host-side computation, not model prose.
  if(JSON.stringify(reported)!==JSON.stringify(ranked))throw Error("Rank output differs from local calculation");
  return {input,ranked,session_id:events[0].sessionID};
}

export function boundedProcess(command,args,{timeoutMs=180000,cwd=ROOT}={}){
  return new Promise(resolveResult=>{
    const start=performance.now();let child,reason=null,bytes=0,stderrBytes=0,finished=false;
    const chunks=[];
    let timer,killTimer;
    function finish(status,stream=""){if(finished)return;finished=true;clearTimeout(timer);clearTimeout(killTimer);resolveResult({status,stream,wall_seconds:(performance.now()-start)/1000});}
    function stop(why){if(reason)return;reason=why;try{process.kill(-child.pid,"SIGTERM");}catch{}killTimer=setTimeout(()=>{try{process.kill(-child.pid,"SIGKILL");}catch{}},1000);}
    try{child=spawn(command,args,{cwd,stdio:["ignore","pipe","pipe"],shell:false,detached:true});}
    catch{finish("spawn_failed");return;}
    timer=setTimeout(()=>stop("timeout"),timeoutMs);
    child.stdout.on("data",buf=>{bytes+=buf.length;if(bytes>MAX_OUTPUT)stop("output_limit");else if(!reason)chunks.push(buf);});
    child.stderr.on("data",buf=>{stderrBytes+=buf.length;if(stderrBytes>MAX_OUTPUT)stop("output_limit");});
    child.on("error",()=>finish("spawn_failed"));
    child.on("close",code=>{if(reason){try{process.kill(-child.pid,"SIGKILL");}catch{}finish(reason);}else if(code!==0)finish("process_failed");else finish("completed",Buffer.concat(chunks).toString("utf8"));});
  });
}

export async function runCases(specification,{limit=1,execute=boundedProcess}={}){
  const spec=parseSpecification(specification);
  if(!spec.ok||!Number.isInteger(limit)||limit<1||limit>MAX_CASES)throw Error("Invalid specification or case limit");
  const cases=[],evidence=[];
  for(const item of spec.cases.slice(0,limit)){
    const prompt="Выполни штатный read-only подбор только по следующему запросу. raw_request в procurement_rank_offers должен точно содержать текст запроса ниже. Если требуется уточнение, не выдумывай данные. Запрос:\n"+item.request;
    const result=await execute("./opencode-entero",["run","--agent","search-orchestrator","--format","json",prompt],{cwd:ROOT,timeoutMs:180000});
    const base={case_id:item.case_id,wall_seconds:result.wall_seconds,observed_at_utc:new Date().toISOString()};
    if(result.status!=="completed"){cases.push({...base,status:result.status});continue;}
    try{
      const extracted=extractRanking(result.stream,item.request);
      cases.push({...base,status:extracted.ranked.primary?"ranked_unreviewed":"no_accepted_offer_unreviewed"});
      evidence.push({case_id:item.case_id,input:extracted.input});
    }catch{cases.push({...base,status:"unreviewable"});}
  }
  return {status:"HUMAN_REVIEW_REQUIRED",total:spec.cases.length,attempted:cases.length,not_attempted:spec.cases.slice(limit).map(c=>c.case_id),cases,evidence};
}
async function main(){
  if(process.platform!=="linux"||process.argv.length!==6||process.argv[2]!=="--live"){
    console.error("Linux only. Usage: node src/specification/live-batch.mjs --live <spec.csv> <1-5> <new-output.json>");return 2;
  }
  const limit=Number(process.argv[4]);
  if(!Number.isInteger(limit)||limit<1||limit>MAX_CASES)return 2;
  let out;
  try{
    const f=await open(process.argv[3],"r");let content;
    try{
      if(!(await f.stat()).isFile())throw Error("Not regular file");
      const buf=Buffer.alloc(256*1024+1);let pos=0;
      while(pos<buf.length){const {bytesRead}=await f.read(buf,pos,buf.length-pos,null);if(!bytesRead)break;pos+=bytesRead;}
      if(pos===buf.length)throw Error("Input too large");
      content=new TextDecoder("utf-8",{fatal:true}).decode(buf.subarray(0,pos));
    }finally{await f.close();}
    const spec=parseSpecification(content);if(!spec.ok)throw Error("Invalid specification");
    // Reserve the private output before spending any provider quota. Never overwrite.
    out=await open(process.argv[5],"wx",0o600);
    const report=await runCases(content,{limit});
    await out.writeFile(JSON.stringify(report,null,2)+"\n");
    console.log(JSON.stringify({attempted:report.attempted,status:report.status,cases:report.cases}));
    return report.cases.every(c=>c.status.endsWith("_unreviewed"))?0:1;
  }catch{console.error("Live batch could not complete; inspect private output and provider state before any retry.");return 1;}
  finally{await out?.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await main();
