// "我會去投票" pledge state: one random 128-bit token per browser kept in localStorage, sent to POST /api/pledge.
// The server stores only its SHA-256, so the token is not a fingerprint and the database holds nothing traceable.
// Storage may be unavailable (private mode, blocked); every access is guarded and the pledge still goes out.
export const PLEDGE_KEY='whospost.pledge';
const TOKEN=/^[a-f0-9]{32}$/;
export const formatCount=count=>Number(count).toLocaleString('en-US');
/** The saved pledge: {token, counted, at} or null. Malformed values are ignored. */
export function readPledge(storage){
 try{const raw=storage?.getItem(PLEDGE_KEY);if(!raw)return null;const v=JSON.parse(raw);return v&&typeof v==='object'&&typeof v.token==='string'&&TOKEN.test(v.token)?{token:v.token,counted:v.counted===true,at:typeof v.at==='string'?v.at:null}:null;}catch{return null;}
}
const write=(storage,value)=>{try{storage?.setItem(PLEDGE_KEY,JSON.stringify(value));}catch{}};
/** The device token, created on first use and written before any request so a double click never makes two. */
export function ensureToken(storage,random=()=>crypto.randomUUID()){
 const saved=readPledge(storage);if(saved)return saved.token;
 const token=String(random()).replace(/-/g,'').toLowerCase().slice(0,32);
 write(storage,{token,counted:false,at:null});
 return token;
}
/**
 * Send the pledge. Resolves {status:'counted'|'already'|'rate_limited'|'error', count}. On 200 the pledge is marked
 * counted locally and pledge_click goes to GA with only `result`; a refusal keeps the token so a retry reuses it.
 */
export async function submitPledge({storage,fetchImpl=globalThis.fetch,analytics=null,random,now=()=>new Date().toISOString()}){
 const token=ensureToken(storage,random);
 try{
  const r=await fetchImpl('/api/pledge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
  let data=null;try{data=await r.json();}catch{}
  const count=Number.isFinite(data?.count)?data.count:null;
  if(r.status===200&&(data?.result==='counted'||data?.result==='already')){
   write(storage,{token,counted:true,at:now()});
   analytics?.track('pledge_click',{result:data.result});
   return {status:data.result,count};
  }
  return {status:r.status===429?'rate_limited':'error',count};
 }catch{return {status:'error',count:null};}
}
