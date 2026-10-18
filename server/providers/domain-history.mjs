// Offline adapter for the official free snapshot. Never visits a shared URL.
export const DOMAIN_DATASET={id:'moda-165027',url:'https://data.gov.tw/dataset/165027',downloadUrl:'https://www-api.moda.gov.tw/OpenData/Files/16352',license:'政府資料開放授權條款第1版',licenseUrl:'https://data.gov.tw/license',matchMethod:'exact_hostname',scoreContribution:0};
const host=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.port?u.hostname.toLowerCase():null;}catch{return null;}};
export function matchDomainHistory(records,snapshot){
 const base={...DOMAIN_DATASET,items:[],reason:'官方網域歷史紀錄獨立於內容真假與帳號評分；未命中不等於安全。'};
 if(!snapshot)return {...base,status:'not_requested'};
 if(!Array.isArray(snapshot.rows)||snapshot.downloadUrl!==DOMAIN_DATASET.downloadUrl||!Number.isFinite(Date.parse(snapshot.collectedAt)))return {...base,status:'unavailable',reason:'來源快照或擷取時間不足，尚未比對。'};
 const index=new Map();let accepted=0;
 for(const raw of snapshot.rows){const value=typeof raw['網域名稱']==='string'?raw['網域名稱'].trim():'';if(!value||/[/?#@:]/.test(value))continue;const hostname=host('https://'+value);if(!hostname)continue;if(!index.has(hostname))index.set(hostname,[]);index.get(hostname).push(raw);accepted++;}
 if(!accepted)return {...base,status:'unavailable',reason:'快照沒有可驗的網域欄位，不能報查無。'};
 const seen=new Set();let detectedUrls=0;
 for(const source of records??[]){for(const match of String(source.text??'').matchAll(/https?:\/\/[^\s<>"）)]+/g)){detectedUrls++;const sharedUrl=match[0].replace(/[。，、；！？,.!;]+$/u,'');const hostname=host(sharedUrl);if(!hostname||!index.has(hostname))continue;for(const raw of index.get(hostname)){const key=JSON.stringify([source.id,source.url,hostname,raw['編號']]);if(seen.has(key))continue;seen.add(key);base.items.push({sourceId:source.id,sourceUrl:source.url,originalText:source.text,sharedUrl,hostname,recordId:raw['編號']??null,recordRaw:raw,reportedAtRaw:raw['接獲通報日期']??null,resolutionStoppedAtRaw:raw['停止解析日期']??null,matchedObject:'shared_url_hostname',matchMethod:'exact_hostname',accountIdentityVerified:false,contentVerdict:'undetermined',scoreContribution:0});}}}
 return {...base,status:!detectedUrls?'not_applicable':base.items.length?'available':'no_match',detectedUrlCount:detectedUrls,snapshot:{collectedAt:snapshot.collectedAt,sha256:snapshot.sha256??null,records:snapshot.rows.length,acceptedRecords:accepted},coverage:'僅核對文字中明示http(s)網址的完整hostname；不展開短網址，不涵蓋未列子網域，也不查帳號身份。'};
}
