// Test-only localhost service. No server/index.mjs import, env loading or Apify runner.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {Store} from '../server/store.mjs';
import {createApp} from '../server/http.mjs';
import {fetchFactChecks} from '../server/providers/cofacts.mjs';
const source={id:'fixture-post',author:'fixture',kind:'authored_reply',text:'政府宣布2026年10月17日台北發放補助，每人可領取1000元。',url:'https://www.threads.com/@fixture/post/fixture-post',parentAuthor:'fixture-parent',parentUrl:'https://www.threads.com/@fixture-parent/post/fixture-parent',postedAt:'2026-10-17T00:00:00Z'};
let calls=0;
const factChecks=await fetchFactChecks([source],{fetchImpl:async()=>{calls++;return new Response(JSON.stringify({data:{ListArticles:{edges:[{node:{id:'fixture-article',status:'NORMAL',text:source.text,articleReplies:[]}}]}}}));}});
const store=new Store(':memory:');
const app=createApp({store,configured:()=>true,fetchAccount:async username=>({account:{username},posts:[],comments:[source],commentsAvailable:true,factChecks})});
await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(8793,'127.0.0.1',resolve);});
try {
 const start=await fetch('http://127.0.0.1:8793/api/scans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://www.threads.com/@fixture'})});
 assert.equal(start.status,202);const {id}=await start.json();let result;
 for(let i=0;i<30;i++) {result=await(await fetch(`http://127.0.0.1:8793/api/scans/${id}`)).json();if(result.status==='completed')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(result.status,'completed');assert.equal(result.analysis.factChecks.claims[0].source.url,source.url);
 assert.equal(result.analysis.factChecks.items[0].verificationStatus,'unanswered');assert.equal(result.score.value,null);assert.equal(calls,1);
 const evidence={fixtureOnly:true,port:8793,externalRequests:0,paidRequests:0,database:':memory:',assertionsPassed:true,result};
 if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({fixtureOnly:true,port:8793,assertionsPassed:true,paidRequests:0}));
} finally {await new Promise(r=>app.server.close(r));store.close();}
