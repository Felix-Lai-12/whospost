// Free pre-check before any paid Apify job: one logged-out GET of the public profile page.
// Measured from Cloudflare egress (2026-10-19): an existing account answers 200 with og tags naming it,
// and an unknown name answers 302 to /login. A browser user agent gets an empty JS shell and no user agent
// at all is sent to /unsupportedbrowser, so the request names this service in a crawler-style agent.
// Anything else (timeouts, 4xx/5xx, a page without the og tags) is 'unknown' and the scan proceeds: the check
// only ever stops a scan on a clear answer, never on its own failure.
const PROFILE='https://www.threads.com/@';
const AGENT='Mozilla/5.0 (compatible; Whospost/1.0; +https://github.com/Felix-Lai-12/whospost)';
// A known public account. A login redirect for the target counts as "not found" only when this one still
// answers with its profile; if it is redirected too, Meta is walling our egress and the answer is 'unknown'.
export const CONTROL_ACCOUNT='hkj331155';
const HEAD_BYTES=65536;
export const PRECHECK_TTL_MS=600000;
// Text Threads shows on a private profile. Not yet seen from a real private account; see the PR notes.
const PRIVATE_MARKERS=[/This (?:profile|account) is private/i,/私人(?:個人檔案|帳號)/];
const decode=s=>s.replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCodePoint(parseInt(h,16))).replace(/&#(\d+);/g,(_,d)=>String.fromCodePoint(Number(d))).replace(/&amp;/g,'&');
// og tags sit in the first few KB of a ~570 KB page; stop reading once they and the head are past.
async function readHead(response){
 if(!response.body)return (await response.text()).slice(0,HEAD_BYTES);
 const reader=response.body.getReader(),decoder=new TextDecoder();let text='';
 try{while(text.length<HEAD_BYTES&&!text.includes('</head>')){const {done,value}=await reader.read();if(done)break;text+=decoder.decode(value,{stream:true});}}
 finally{reader.cancel().catch(()=>{});}
 return text;
}
/** One profile page: 'available' | 'private' | 'login' (redirected to sign-in) | 'unknown'. */
async function probe(username,{fetchImpl,timeoutMs}){
 let response;
 try{response=await fetchImpl(PROFILE+username,{headers:{'User-Agent':AGENT,Accept:'text/html'},redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});}catch{return 'unknown';}
 if([301,302,303,307,308].includes(response.status)){
  response.body?.cancel().catch(()=>{});
  try{return /^\/(?:accounts\/)?login\/?$/.test(new URL(response.headers.get('location'),PROFILE).pathname)?'login':'unknown';}catch{return 'unknown';}
 }
 if(response.status!==200){response.body?.cancel().catch(()=>{});return 'unknown';}
 let head;try{head=await readHead(response);}catch{return 'unknown';}
 const title=decode(head.match(/<meta property="og:title" content="([^"]*)"/)?.[1]??'').toLowerCase();
 if(!title.includes(`(@${username.toLowerCase()})`))return 'unknown';
 return PRIVATE_MARKERS.some(re=>re.test(decode(head)))?'private':'available';
}
/** Returns {status:'available'|'private'|'not_found'|'unknown', ms}. Never throws. */
export async function checkThreadsProfile(username,{fetchImpl=globalThis.fetch,timeoutMs=3000,control=CONTROL_ACCOUNT,now=Date.now}={}){
 const started=now(),done=status=>({status,ms:now()-started});
 const target=await probe(username,{fetchImpl,timeoutMs});
 if(target!=='login')return done(target==='available'||target==='private'?target:'unknown');
 if(username.toLowerCase()===control)return done('unknown');
 return done(await probe(control,{fetchImpl,timeoutMs})==='available'?'not_found':'unknown');
}
