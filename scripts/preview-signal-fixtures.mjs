// Local preview of the synthetic negative controls (tests/fixtures/signal-negative-controls.mjs) on the real
// result page. In-memory store, no providers, no network, no credentials. Run `npm run build` first.
//   node scripts/preview-signal-fixtures.mjs            # http://127.0.0.1:8788/?scan=demo-demo.fan
import {resolve,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {Store} from '../server/store.mjs';import {createApp} from '../server/http.mjs';
import {negativeControls} from '../tests/fixtures/signal-negative-controls.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),store=new Store(':memory:');
const seed=scan=>{const {id}=store.create(scan.account.username);const {mutual,...rest}=scan;store.update(id,{...rest,id});return id;};
// Partners the fan and the arguer reply to, saved so the mutual rule can be read as "no" instead of unknown.
const partner=(username,target)=>({status:'completed',account:{username,url:`https://www.threads.com/@${username}`,name:`${username}（合成）`},posts:[],completedAt:'2026-10-01T00:00:00.000Z',comments:Array.from({length:8},(_,i)=>({id:`c${i}`,kind:'authored_reply',author:username,text:`回覆第 ${i+1} 則，內容各不相同的一般對話。`,postedAt:`2026-10-0${1+i}T01:00:00.000Z`,url:`https://www.threads.com/@${username}/post/${username.replace(/\W/g,'')}${i}`,parentAuthor:target,parentUrl:`https://www.threads.com/@${target}/post/t${i}`,isQuote:false,isRepost:false}))});
seed(partner('demo.creator','demo.someone'));seed(partner('demo.viral','demo.someone'));
const ids=negativeControls().map(c=>[c.label,seed(c.scan)]);
const app=createApp({store,configured:()=>false,distDir:resolve(root,'dist'),fetchAccount:async()=>{throw Error('preview only: no scans are fetched');}});
const port=Number(process.env.PORT??8788);
app.server.listen(port,'127.0.0.1',()=>{console.log(`Signal fixture preview http://127.0.0.1:${port}`);for(const [label,id] of ids)console.log(`  ${label}: http://127.0.0.1:${port}/?scan=${id}`);});
