// sha256(lowercase(username)) as hex: the only identity the list carries (worker/account-list.mjs hashUsername hashes
// the same way). A Promise cache so an account seen ten times on one page is hashed once (§6.5, after PronounDB).
const encoder=new TextEncoder();
export async function sha256Hex(text){
 const digest=await crypto.subtle.digest('SHA-256',encoder.encode(String(text)));
 return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export const hashUsername=username=>sha256Hex(String(username).toLowerCase());
/** An LRU of username → Promise<hash>, at most `max` entries; the oldest untouched entry leaves first. */
export function createHashCache({max=10000,hash=hashUsername}={}){
 const cache=new Map();
 return {
  hash(username){
   const key=String(username).toLowerCase();
   if(cache.has(key)){const p=cache.get(key);cache.delete(key);cache.set(key,p);return p;}
   const p=hash(key);cache.set(key,p);
   // A rejection is not kept: the next call hashes again instead of failing every scan the account appears in.
   p.catch(()=>{if(cache.get(key)===p)cache.delete(key);});
   if(cache.size>max)cache.delete(cache.keys().next().value);
   return p;
  },
  get size(){return cache.size;}
 };
}
