// Structured logging shared by the Worker and the Node server: one JSON object per line, so Workers Logs can
// filter on event, status, code, scanId, username and durationMs. Each call is one billable Workers Logs event,
// so static-asset requests are not logged unless they fail (see requestLogger).
// Nothing sensitive goes in: keys that carry a raw IP, a Turnstile token, an admin or API token, or a request
// body are replaced before serialising, Error objects become their message, and long strings are cut. Callers
// still pass only what an operator needs (a username is fine; a user's full input is not).
const CONSOLE_METHOD={debug:'debug',info:'log',warn:'warn',error:'error'};
const SENSITIVE=/(^|_)(ip|remoteip|remote_ip|client_ip)$|token|secret|authorization|password|api[-_]?key|cookie|^body$|^text$|^input$|^payload$/i;
const MAX_STRING=300;
let sink=(level,line)=>console[CONSOLE_METHOD[level]??'log'](line);
/** Replaces the output function (level, line) => void; returns a function that restores the previous one. Tests use it. */
export function setLogSink(next){const previous=sink;sink=next;return ()=>{sink=previous;};}
function clean(value,depth=0){
 if(value===undefined||typeof value==='function')return undefined;
 if(value instanceof Error)return String(value.message??value).slice(0,MAX_STRING);
 if(typeof value==='string')return value.length>MAX_STRING?`${value.slice(0,MAX_STRING)}…`:value;
 if(typeof value==='number')return Number.isFinite(value)?value:String(value);
 if(value===null||typeof value!=='object')return value;
 if(depth>=3)return '[nested]';
 if(Array.isArray(value))return value.slice(0,20).map(v=>clean(v,depth+1));
 const out={};
 for(const [k,v] of Object.entries(value)){if(SENSITIVE.test(k)){out[k]='[redacted]';continue;}const c=clean(v,depth+1);if(c!==undefined)out[k]=c;}
 return out;
}
/**
 * log(level, event, fields): level is debug|info|warn|error, event a dotted name such as 'request', 'gate.denied',
 * 'scan.completed', 'apify.run', 'gemini.generate' / 'claude.generate' (AI events are prefixed with the provider
 * that answered, WHOSPOST_AI_PROVIDER, and carry a `provider` field), 'do.error'. Known fields: status, code, scanId, username,
 * durationMs, usd, error. Never throws: a logging failure must not fail the request.
 */
export function log(level,event,fields={}){
 try{
  const entry={level:CONSOLE_METHOD[level]?level:'info',event:String(event),...clean(fields)};
  if(typeof entry.durationMs==='number')entry.durationMs=Math.round(entry.durationMs);
  sink(entry.level,JSON.stringify(entry));
 }catch{}
}
/** Returns a function giving the whole milliseconds elapsed since the call. */
export function timer(now=Date.now){const start=now();return ()=>Math.max(0,Math.round(now()-start));}
/** Collapses ids out of a path so Workers Logs groups by route: /api/scans/<uuid> → /api/scans/:id. */
export function pathPattern(pathname){
 return String(pathname)
  .replace(/^\/api\/(og|avatar)\/[a-f0-9-]{36}\.png$/,'/api/$1/:id.png')
  .replace(/^\/api\/(admin\/)?scans\/[\w-]{8,}(?=\/|$)/,'/api/$1scans/:id');
}
/**
 * Wraps a fetch handler: every API request and the HTML page get one 'request' event (method, path pattern,
 * status, durationMs, colo, ray); other static assets are logged only when they fail. A handler that throws is
 * logged as a 500 and answered with a plain 500 so the client never hangs.
 */
export function requestLogger(handler,{now=Date.now}={}){
 return async function fetch(request,...rest){
  const elapsed=timer(now),url=new URL(request.url),path=pathPattern(url.pathname),api=url.pathname.startsWith('/api/')||url.pathname==='/';
  let response;
  try{response=await handler(request,...rest);}
  catch(e){
   log('error','request.unhandled',{method:request.method,path,status:500,durationMs:elapsed(),error:e});
   return new Response(JSON.stringify({error:'服務暫時無法回應'}),{status:500,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
  }
  const status=response?.status??0;
  if(api||status>=400)log(status>=500?'error':status>=400?'warn':'info','request',{method:request.method,path,status,durationMs:elapsed(),colo:request.cf?.colo,ray:request.headers.get('cf-ray')??undefined});
  return response;
 };
}
