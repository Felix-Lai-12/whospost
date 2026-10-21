import {signalScore} from '../shared/signals.mjs';
export const LIST_VERSION='list-v1';
const hash=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function listEntry(scan,{appeals=0,ai=null}={}){
 const username=String(scan.account?.username??'').toLowerCase();
 if(scan.status!=='completed'||!/^[a-z0-9_.]{1,30}$/.test(username))return null;
 const redact=value=>{let text=String(value??'').replace(/@[a-zA-Z0-9_.]+/g,'對象帳號');for(const name of [username,scan.account?.name].filter(Boolean))text=text.split(name).join('對象帳號');return text;};
 const score=signalScore(scan),ready=ai?.result?.status==='ready'?ai.result.result:null;
 return {h:await hash(username),score:score.value,hits:score.items.filter(x=>x.status==='yes').map(({id,label,detail})=>({id,label,detail:redact(detail)})),assessed:score.assessed,unknown:score.unknown,evidence:ready?'ai':'rules',ai:ready?{summary:redact(ready.conclusion).slice(0,300),version:score.version}:null,scanId:scan.id,updated:scan.updatedAt??scan.completedAt??scan.createdAt,appeals};
}
/** JSON containing only hash identities; row-by-row reads avoid a multi-MiB RPC payload. */
export async function accountList(core){
 const cached=core.store.cacheGet(LIST_VERSION);if(cached)return cached;
 const db=core.store.db,seen=new Set(),accounts=[];
 for(const {id,username} of db.prepare("SELECT id,username FROM scans WHERE status='completed' ORDER BY created_at DESC").all()){
  const key=username.toLowerCase();if(seen.has(key))continue;seen.add(key);
  const scan=core.store.scanView(id);if(!scan)continue;
  const appeals=db.prepare('SELECT COUNT(*) AS n FROM appeals WHERE h=?').get(await hash(key)).n;
  const entry=await listEntry(scan,{appeals,ai:core.aiInspect(id)});if(entry)accounts.push(entry);
 }
 const value={license:'CC BY-SA 4.0',attribution:'Whospost; observed behavior, not identity attribution',generated:new Date().toISOString(),accounts};core.store.cacheSet(LIST_VERSION,value);return value;
}
export function saveAppeal(core,{h,installHash,reason=''}){
 if(!/^[a-f0-9]{64}$/.test(h??'')||!/^[a-f0-9]{64}$/.test(installHash??'')||typeof reason!=='string'||reason.length>500)throw new Error('invalid appeal');
 core.store.db.prepare('INSERT OR IGNORE INTO appeals(h,install_hash,created_at,reason) VALUES(?,?,?,?)').run(h,installHash,new Date().toISOString(),reason);
 core.store.db.prepare('DELETE FROM cache WHERE key=?').run(LIST_VERSION);
 return {ok:true};
}
