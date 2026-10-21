const ROOT='https://whospost.felixlai.workers.dev';
const inflight=new Map();
async function bucket(prefix){
 if(!/^[a-f0-9]{4}$/.test(prefix))throw Error('invalid prefix');
 const key=`bucket:${prefix}`,saved=(await chrome.storage.local.get(key))[key];
 if(saved?.expires>Date.now())return saved.rows;
 if(inflight.has(prefix))return inflight.get(prefix);
 const work=(async()=>{const response=await fetch(`${ROOT}/api/list/v1/bucket/${prefix}`,{credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)throw Error('清單暫時無法讀取');const rows=await response.json();if(!Array.isArray(rows))throw Error('清單格式不符');await chrome.storage.local.set({[key]:{expires:Date.now()+3600000,rows},lastUpdated:Date.now()});return rows;})().finally(()=>inflight.delete(prefix));
 inflight.set(prefix,work);return work;
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(!sender.url||!/^https:\/\/www\.threads\.(com|net)\//.test(sender.url))return;
 if(message.type==='bucket'){bucket(message.prefix).then(rows=>reply({rows}),()=>reply({error:'清單暫時無法讀取'}));return true;}
 if(message.type==='appeal'){
  (async()=>{const data=await chrome.storage.local.get('installId');const id=data.installId||crypto.randomUUID();if(!data.installId)await chrome.storage.local.set({installId:id});const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`whospost-appeal:${id}`));const installHash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');const response=await fetch(`${ROOT}/api/list/v1/appeal`,{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({h:message.h,installHash})});return {ok:response.ok};})().then(reply,()=>reply({ok:false}));return true;
 }
});
