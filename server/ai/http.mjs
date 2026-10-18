// Returns false for non-AI routes. The caller has already checked Host.
export async function handleAiRoute({req,res,url,store,service,send}){
 if(url.pathname==='/api/ai/status'){send(res,req.method==='GET'?200:405,req.method==='GET'?(service?.capabilities()??{enabled:false,configured:false,budget:null}):{error:'不支援的請求'});return true;}
 const match=url.pathname.match(/^\/api\/scans\/([\w-]+)\/ai$/);if(!match)return false;
 if(!['GET','POST'].includes(req.method)){send(res,405,{error:'不支援的請求'});return true;}
 if(req.method==='POST'){
  const origin=req.headers.origin;if(origin&&origin!==`http://${req.headers.host}`){send(res,403,{error:'不接受外部網站啟動 AI 判讀'});return true;}
  if(!req.headers['content-type']?.includes('application/json')){send(res,415,{error:'需使用JSON'});return true;}
 }
 const scan=store.get(match[1]);if(!scan){send(res,404,{error:'找不到查詢紀錄'});return true;}
 let options={};
 if(req.method==='POST'){
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>512){send(res,413,{error:'輸入過長'});return true;}}
  try{options=JSON.parse(body||'{}');if(!options||Array.isArray(options)||typeof options!=='object'||Object.keys(options).some(k=>k!=='retry')||(Object.hasOwn(options,'retry')&&typeof options.retry!=='boolean'))throw Error();}catch{send(res,400,{error:'只接受可選的 retry 布林值'});return true;}
 }
 const result=service?(req.method==='GET'?service.inspect(scan):service.start(scan,options)):{status:'disabled',message:'AI 自動判讀尚未啟用。',result:null};
 const status=req.method==='GET'?200:({processing:202,ready:200,no_data:409,scan_not_ready:409,disabled:503,not_configured:503,budget_exceeded:429,invalid_output:422,preflight_failed:503,indeterminate:409,response_too_large:413}[result.status]??200);
 send(res,status,{scanId:scan.id,account:scan.account.username,...result});return true;
}
