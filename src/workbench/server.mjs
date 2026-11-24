import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseSpecification } from "../specification/intake.mjs";
import { comparisonCsv } from "../specification/export.mjs";
import { rankEnteroResults } from "../workflow/contracts.mjs";

const assets = new Map([
  ["/", ["./index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["./app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["./styles.css", "text/css; charset=utf-8"]],
  ["/fixtures/specification.csv", ["../../docs/benchmark-cases.csv", "text/csv; charset=utf-8"]],
  ["/fixtures/ranking.json", ["../../docs/fixtures/synthetic-ranking-input.json", "application/json; charset=utf-8"]]
]);
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  "Cross-Origin-Resource-Policy": "same-origin"
};
function respond(res, status, type, body) {
  res.writeHead(status, { ...headers, "Content-Type": type });
  res.end(body);
}
function json(res,status,body) {
  respond(res,status,"application/json; charset=utf-8",JSON.stringify(body));
}
class RequestError extends Error {
  constructor(status,message) { super(message); this.status=status; }
}
async function body(req,limit) {
  const chunks=[]; let size=0;
  if (Number(req.headers["content-length"])>limit) throw new RequestError(413,"Input exceeds size limit");
  for await (const part of req) {
    size+=part.length;
    if (size>limit) throw new RequestError(413,"Input exceeds size limit");
    chunks.push(part);
  }
  return new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks));
}
export function createWorkbench() {
  const server=createServer(async(req,res)=>{
    try {
      const addr=server.address();
      const host="127.0.0.1:"+addr.port;
      if (req.headers.host!==host) return json(res,403,{error:"Loopback host required"});
      if (req.headers.origin && req.headers.origin!=="http://"+host) return json(res,403,{error:"Origin denied"});
      if (req.headers["sec-fetch-site"]==="cross-site") return json(res,403,{error:"Cross-site request denied"});
      if (req.method==="GET" && assets.has(req.url)) {
        const [file,type]=assets.get(req.url);
        return respond(res,200,type,await readFile(new URL(file,import.meta.url)));
      }
      if (req.method!=="POST" || !["/api/specification","/api/comparison"].includes(req.url))
        return json(res,404,{error:"Route not found"});
      if (req.url==="/api/specification") {
        if (req.headers["content-type"]!=="text/csv") return json(res,415,{error:"Expected text/csv"});
        const result=parseSpecification(await body(req,256*1024));
        return json(res,result.ok?200:422,result);
      }
      if (req.headers["content-type"]!=="application/json") return json(res,415,{error:"Expected application/json"});
      const input=JSON.parse(await body(req,512*1024));
      if (!Array.isArray(input?.candidates)||input.candidates.length>100)
        return json(res,422,{error:"Expected at most 100 candidates"});
      const ranked=rankEnteroResults(input);
      return json(res,200,{ranked,csv:comparisonCsv(input),verification:"OFFLINE_NOT_VERIFIED"});
    } catch(err) {
      if (!res.headersSent && !res.destroyed)
        json(res,err instanceof RequestError?err.status:422,{error:err instanceof RequestError?err.message:"Invalid input or processing failed"});
    }
  });
  server.requestTimeout=15000;
  server.headersTimeout=10000;
  return server;
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const server=createWorkbench();
  const port=Number(process.env.PORT??4173);
  if (!Number.isInteger(port)||port<1024||port>65535) throw new Error("Invalid PORT");
  server.listen(port,"127.0.0.1",()=>console.log("Local offline workbench: http://127.0.0.1:"+port));
}
