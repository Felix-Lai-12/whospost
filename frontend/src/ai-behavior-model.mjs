// Binds a user-accepted model response to the exact account/evidence, never a handle alone.
export function aiEvidenceSignature(scan){
 const account=scan?.account;
 if(typeof account?.username!=='string')throw Error('Missing account');
 const rows=new Map();
 for(const r of [...(scan.posts??[]),...(scan.comments??[])]){
  if(!r.id||r.author!==account.username)continue;
  const row={id:`activity:${r.id}`,kind:r.kind,text:r.text??'',author:r.author,postedAt:r.postedAt??null,url:r.url??null,parentUrl:r.parentUrl??null,parentAuthor:r.parentAuthor??null,parentText:r.parentText??null,isQuote:r.isQuote===true,isRepost:r.isRepost===true};
  if(rows.has(row.id)&&JSON.stringify(rows.get(row.id))!==JSON.stringify(row))throw Error('Conflicting evidence versions');
  rows.set(row.id,row);
 }
 return JSON.stringify({account:{username:account.username,name:account.name??null},evidence:[...rows.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)});
}
export async function aiEvidenceHash(scan){
 const bytes=new TextEncoder().encode(aiEvidenceSignature(scan));
 const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function approvedAiForScan(scan,entries){
 if(scan?.status!=='completed'||!Array.isArray(entries))return null;
 const candidates=entries.filter(x=>x.account===scan.account?.username&&x.review?.status==='user_accepted');
 if(!candidates.length)return null;
 const hash=await aiEvidenceHash(scan),match=candidates.find(x=>x.evidenceHash===hash);
 if(!match)return null;
 const {conclusion,findings}=match.output??{};
 if(typeof conclusion!=='string'||!conclusion.trim()||!Array.isArray(findings)||!findings.length||findings.length>4||findings.some(f=>typeof f.behavior!=='string'||!f.behavior.trim()||typeof f.interpretation!=='string'||!f.interpretation.trim()))return null;
 // Explicit projection: limitations and internal evidence/review fields are not rendered.
 return {conclusion,findings:findings.map(f=>({title:f.behavior,text:f.interpretation})),model:match.model,generatedAt:match.generatedAt};
}
