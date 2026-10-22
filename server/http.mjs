import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {collectionProfile} from './collection-profile.mjs';
import {createApi} from './api.mjs';
import {runScan} from './scan-runner.mjs';
export {parseAccount} from './parse-account.mjs';
// Node server for local development and tests. Routing lives in api.mjs, shared with the Worker.
export function createApp({store,fetchAccount,settleBills=null,distDir=resolve('dist'),configured=()=>!!process.env.APIFY_TOKEN,aiService=null,profileId='standard',crossAccountSearch=false,localComparison=true,precheck=null}){
 const profile=collectionProfile(profileId);
 const running=new Set(),again=new Set();
 async function run(id){
  if(running.has(id)){again.add(id);return;}
  running.add(id);
  try{
   await runScan(id,{store,fetchAccount,precheck,crossAccountSearch,localComparison});
   // Bills settle after the result is saved; a reservation left unconfirmed keeps counting at its cap.
   if(settleBills)try{await settleBills(()=>store.getState(id),{budget:store.budget,onState:s=>store.setState(id,s)});}catch(e){console.warn(`Apify bill settlement stopped: ${e?.message??e}`);}
  }finally{running.delete(id);}
  // A failed scan requested again while its bills settled runs now.
  if(again.delete(id)&&store.get(id)?.status==='queued')await run(id);
 }
 const ai=aiService&&{status:()=>aiService.capabilities(),inspect:id=>{const s=store.get(id);return s&&{account:s.account.username,result:aiService.inspect(s)};},start:(id,options)=>{const s=store.get(id);return s&&{account:s.account.username,result:aiService.start(s,options)};}};
 const api=createApi({store,ai,profile,configured,startRun:id=>{setImmediate(()=>run(id));}});
 const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
 const server=createServer(async(req,res)=>{try{const expectedHost=`127.0.0.1:${server.address()?.port}`;const alternateHost=`localhost:${server.address()?.port}`;if(![expectedHost,alternateHost].includes(req.headers.host))return send(res,403,{error:'無效Host'});const url=new URL(req.url,`http://${req.headers.host}`);
 if(url.pathname.startsWith('/api/')){
  let body=null;if(!['GET','HEAD'].includes(req.method)){body='';for await(const part of req){body+=part;if(body.length>65536)return send(res,413,{error:'輸入過長'});}}
  const response=await api(new Request(url,{method:req.method,headers:Object.entries(req.headers).filter(([,v])=>typeof v==='string'),body}));
  res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(await response.text());
 }
 if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'不支援的請求'});
 let relative;try{relative=decodeURIComponent(url.pathname);}catch{return send(res,400,{error:'無效網址'});}let path=resolve(distDir,'.'+relative);if(path!==resolve(distDir)&&!path.startsWith(resolve(distDir)+'/'))return send(res,403,{error:'無效路徑'});try{if(!(await stat(path)).isFile())path=resolve(distDir,'index.html');}catch{path=resolve(distDir,'index.html');}const content=await readFile(path);res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'})[extname(path)]??'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"});res.end(req.method==='HEAD'?undefined:content);
 }catch{return send(res,500,{error:'服務暫時無法回應'});}});
 return {server,run,resume:()=>store.pending().forEach(id=>run(id))};
}
