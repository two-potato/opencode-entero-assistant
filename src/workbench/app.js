const $=id=>document.getElementById(id);
let exportCsv=null;
const money=new Intl.NumberFormat("ru-RU",{style:"currency",currency:"RUB",maximumFractionDigits:0});
function table(target,columns,rows) {
  const t=document.createElement("table"), head=t.createTHead().insertRow(), b=t.createTBody();
  for(const title of columns){const th=document.createElement("th");th.scope="col";th.textContent=title;head.append(th);}
  for(const row of rows){const tr=b.insertRow();for(const value of row){tr.insertCell().textContent=value??"—";}}
  $(target).replaceChildren(t);
}
async function sample(url,target,status) {
  try{const res=await fetch(url);if(!res.ok)throw Error();$(target).value=await res.text();$(status).textContent="Синтетический пример загружен.";}
  catch{$(status).textContent="Не удалось загрузить пример.";}
}
function resetComparison(){
  exportCsv=null;$("download").disabled=true;$("offers").replaceChildren();$("caveats").textContent="";
  for(const id of ["primary-count","analog-count","rejected-count"])$(id).textContent="—";
}
function file(input,target,status,limit,clear){
  $(input).addEventListener("change",async()=>{
    const f=$(input).files[0];if(!f)return;
    clear();
    $(target).value="";
    if(f.size>limit){$(status).textContent="Файл слишком большой.";return;}
    try{$(target).value=new TextDecoder("utf-8",{fatal:true}).decode(await f.arrayBuffer());$(status).textContent="Файл загружен локально.";}
    catch{$(status).textContent="Требуется UTF-8.";}
  });
}
const resetSpec=()=>{$("spec-table").replaceChildren();$("spec-status").textContent="";};
$("spec").addEventListener("input",resetSpec);
$("ranking").addEventListener("input",()=>{resetComparison();$("rank-status").textContent="";});
file("spec-file","spec","spec-status",256*1024,resetSpec);
file("rank-file","ranking","rank-status",512*1024,resetComparison);
$("sample-spec").addEventListener("click",()=>{resetSpec();sample("/fixtures/specification.csv","spec","spec-status");});
$("sample-rank").addEventListener("click",()=>{resetComparison();sample("/fixtures/ranking.json","ranking","rank-status");});
async function post(url,type,body){
  const r=await fetch(url,{method:"POST",headers:{"Content-Type":type},body});
  const result=await r.json();
  if(!r.ok&&!result.errors)throw Error(result.error??"Ошибка");
  return result;
}
$("validate").addEventListener("click",async()=>{
  resetSpec();const raw=$("spec").value;$("validate").disabled=true;
  try{
    const r=await post("/api/specification","text/csv",raw);
    if($("spec").value!==raw)return;
    if(!r.ok){$("spec-status").textContent=r.errors.map(e=>"Строка "+e.row+": "+e.reason).join("\n");return;}
    $("spec-status").textContent="Проверено позиций: "+r.cases.length;
    table("spec-table",["ID","Категория","Требования"],r.cases.map(c=>[c.case_id,c.category,c.request]));
  }catch(e){$("spec-status").textContent=e.message;}finally{$("validate").disabled=false;}
});
$("compare").addEventListener("click",async()=>{
  resetComparison();const raw=$("ranking").value;$("compare").disabled=true;
  try{
    const result=await post("/api/comparison","application/json",raw);
    if($("ranking").value!==raw)return;
    const r=result.ranked, accepted=[r.primary,...r.analogs].filter(Boolean);
    $("primary-count").textContent=r.primary?1:0;$("analog-count").textContent=r.analogs.length;
    $("rejected-count").textContent=r.rejected.length;
    const rows=accepted.map(x=>[x.role,x.title,money.format(x.price_rub),x.availability,x.url,x.verified_at,x.caveats.join("; ")]);
    for(const x of [...r.not_found,...r.rejected])rows.push([x.status??"rejected",x.requested_model,"—","—","—","—",x.reason]);
    table("offers",["Статус","Модель","Цена","Наличие","Источник (текст)","Время","Примечания"],rows);
    $("caveats").textContent=(r.primary?"":"Нет принятого предложения. ")+(r.shortfall?"Не хватает аналогов: "+r.shortfall.missing:"");
    $("rank-status").textContent="Ранжирование выполнено локально. Источники не проверялись.";
    exportCsv=result.csv;$("download").disabled=false;
  }catch(e){$("rank-status").textContent=e.message;}finally{$("compare").disabled=false;}
});
$("download").addEventListener("click",()=>{
  if(exportCsv===null)return;
  const url=URL.createObjectURL(new Blob([exportCsv],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download="comparison.csv";a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});
