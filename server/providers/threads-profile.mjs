// Free pre-check before any paid Apify job: one logged-out GET of the public profile page.
// Measured from Cloudflare egress (2026-10-19): an existing account answers 200 with og tags naming it, and its
// user record carries text_post_app_is_private (true for a private account, whose page otherwise looks public);
// an unknown name answers 302 to /login. A browser user agent gets an empty JS shell and no user agent
// at all is sent to /unsupportedbrowser, so the request names this service in a crawler-style agent.
// Anything else (timeouts, 4xx/5xx, a page without the og tags) is 'unknown' and the scan proceeds: the check
// only ever stops a scan on a clear answer, never on its own failure.
const PROFILE='https://www.threads.com/@';
export const AGENT='Mozilla/5.0 (compatible; Whospost/1.0; +https://github.com/Felix-Lai-12/whospost)';
// A known public account. A login redirect for the target counts as "not found" only when this one still
// answers with its profile; if it is redirected too, Meta is walling our egress and the answer is 'unknown'.
export const CONTROL_ACCOUNT='hkj331155';
const MAX_BYTES=1048576;
export const PRECHECK_TTL_MS=600000;
const decode=s=>s.replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCodePoint(parseInt(h,16))).replace(/&#(\d+);/g,(_,d)=>String.fromCodePoint(Number(d))).replace(/&amp;/g,'&');
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// og:title is "Name (@user) • Threads, Say more", or "@user • Threads, Say more" when there is no display name.
const namesAccount=(head,username)=>{const title=decode(head.match(/<meta property="og:title" content="([^"]*)"/)?.[1]??'').toLowerCase();return title.includes(`(@${username})`)||title.startsWith(`@${username} `);};
/** Reads the page as it streams: the head must name the account, then the account's own user record (about
 *  300 KB in) says whether it is private. Other authors on the page carry the same field, so it must sit right
 *  before this account's username. Stops at that record; a page without it still counts as available. */
async function readProfile(response,username){
 const own=new RegExp(`"text_post_app_is_private":(true|false),"username":"${escape(username)}"`);
 const reader=response.body.getReader(),decoder=new TextDecoder();let text='',checked=0,named=false;
 try{
  for(;;){
   const {done,value}=await reader.read();if(done)break;text+=decoder.decode(value,{stream:true});
   // Each chunk is searched once, with an overlap for a tag or record split across chunks.
   if(!named){if(!text.includes('</head>',Math.max(0,checked-7))&&text.length<MAX_BYTES){checked=text.length;continue;}if(!namesAccount(text,username))return 'unknown';named=true;checked=0;}
   const found=own.exec(text.slice(Math.max(0,checked-200)));if(found)return found[1]==='true'?'private':'available';
   checked=text.length;if(text.length>=MAX_BYTES)break;
  }
  return named||namesAccount(text,username)?'available':'unknown';
 }finally{reader.cancel().catch(()=>{});}
}
/** One profile page: 'available' | 'private' | 'login' (redirected to sign-in) | 'unknown'. */
async function probe(username,{fetchImpl,timeoutMs}){
 let response;
 try{response=await fetchImpl(PROFILE+username,{headers:{'User-Agent':AGENT,Accept:'text/html'},redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});}catch{return 'unknown';}
 if([301,302,303,307,308].includes(response.status)){
  response.body?.cancel().catch(()=>{});
  try{return /^\/(?:accounts\/)?login\/?$/.test(new URL(response.headers.get('location'),PROFILE).pathname)?'login':'unknown';}catch{return 'unknown';}
 }
 if(response.status!==200||!response.body){response.body?.cancel().catch(()=>{});return 'unknown';}
 try{return await readProfile(response,username.toLowerCase());}catch{return 'unknown';}
}
/** Returns {status:'available'|'private'|'not_found'|'unknown', ms}. Never throws. */
export async function checkThreadsProfile(username,{fetchImpl=globalThis.fetch,timeoutMs=3000,control=CONTROL_ACCOUNT,now=Date.now}={}){
 const started=now(),done=status=>({status,ms:now()-started});
 const target=await probe(username,{fetchImpl,timeoutMs});
 if(target!=='login')return done(target==='available'||target==='private'?target:'unknown');
 if(username.toLowerCase()===control)return done('unknown');
 return done(await probe(control,{fetchImpl,timeoutMs})==='available'?'not_found':'unknown');
}
