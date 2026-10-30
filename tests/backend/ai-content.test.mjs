// The AI content judgement (signals-v3 item 8, 「AI 判讀內容異常」, Felix 10-30): high-grade hate speech only; a yes
// stands only on sentences found word for word in the account's own text, and anything unsure reads as no.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {buildAccountContentInput,projectAccountContent,CONTENT_TARGETS} from '../../server/providers/account-content.mjs';
import {AiService,BEHAVIOR_CONTRACT,CONTENT_CONTRACT} from '../../server/ai/service.mjs';
import {AiStore} from '../../server/ai/store.mjs';
import {StoreObjectCore} from '../../worker/store-object.mjs';

const NAME='fixture_content';
const scan=()=>({id:'fixture-content',status:'completed',account:{username:NAME,name:'合成測試帳號',url:`https://www.threads.com/@${NAME}`},completedAt:'2026-10-30T00:00:00Z',
 posts:[{id:'p1',author:NAME,kind:'post',text:'合成句：某群人都是害蟲，應該全部趕出去。',url:`https://www.threads.com/@${NAME}/post/p1`},{id:'p2',author:NAME,kind:'post',text:'轉貼別人的文字',isRepost:true},{id:'p3',author:'someone_else',kind:'post',text:'別人寫的'}],
 comments:[{id:'c1',author:NAME,kind:'authored_reply',text:'這個政策很爛。',parentUrl:'https://www.threads.com/@x/post/a'},{id:'c2',author:NAME,kind:'authored_reply',text:'   '}]});
const PROMPT=readFileSync(new URL('../../prompts/account-content.md',import.meta.url),'utf8');

test('the content packet is the account\'s own words only: no reposts, no one else\'s text, no empty rows, no parents',()=>{
 const input=buildAccountContentInput(scan());
 assert.deepEqual(input,{account:{username:NAME},evidence:[{id:'activity:p1',kind:'post',text:'合成句：某群人都是害蟲，應該全部趕出去。'},{id:'activity:c1',kind:'authored_reply',text:'這個政策很爛。'}]});
});

test('a yes stands only on a verbatim sentence; no, unsure and unverifiable all read as no (寧可漏報)',()=>{
 const input=buildAccountContentInput(scan());
 const yes=projectAccountContent(input,{hateful:true,quotes:[{evidenceId:'activity:p1',quote:'某群人都是害蟲'}],targets:['族群','不在清單的詞']});
 assert.deepEqual(yes,{hateful:true,quotes:[{evidenceId:'activity:p1',quote:'某群人都是害蟲'}],targets:['族群']});
 assert.deepEqual(projectAccountContent(input,{hateful:false,quotes:[{evidenceId:'activity:p1',quote:'某群人都是害蟲'}],targets:['族群']}),{hateful:false,quotes:[],targets:[]});
 for(const quotes of [[],[{evidenceId:'activity:p1',quote:'某群人都是病毒'}],[{evidenceId:'activity:c1',quote:'某群人都是害蟲'}],[{evidenceId:'activity:p1',quote:'害蟲'}]])
  assert.deepEqual(projectAccountContent(input,{hateful:true,quotes,targets:['族群']}),{hateful:false,quotes:[],targets:[],unverified:true},JSON.stringify(quotes));
 for(const bad of [{hateful:'yes',quotes:[],targets:[]},{hateful:true,quotes:[],targets:[],reason:'x'},{hateful:true,quotes:[{evidenceId:'a'}],targets:[]},{hateful:true,quotes:Array(4).fill({evidenceId:'activity:p1',quote:'某群人都是害蟲'}),targets:[]}])
  assert.throws(()=>projectAccountContent(input,bad),bad.reason?/field/:/Invalid|field/);
 assert.ok(CONTENT_TARGETS.every(t=>PROMPT.includes(t)),'the prompt lists every allowed target word');
});

test('the prompt says unsure is no, and keeps politics, insults of one person and quoted hate out',()=>{
 for(const phrase of ['只要不確定，就回答沒有','政治人物','引用、轉述','逐字、連續'])assert.ok(PROMPT.includes(phrase),phrase);
 assert.doesNotMatch(PROMPT,/網軍|機器人/);
});

const answer=(output,model='gemini-3.8-flash')=>({modelVersion:model,candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}],usageMetadata:{promptTokenCount:80,candidatesTokenCount:20}});
function service(contract,generate){
 const ledger=new AiStore(':memory:',{limitUsd:.1}),tasks=[];
 const s=new AiService({store:ledger,transport:{count:async()=>80,generate},prompt:contract===CONTENT_CONTRACT?PROMPT:'behaviour prompt',contract,enabled:true,configured:true,maxOutputTokens:1024,schedule:fn=>tasks.push(fn)});
 return {s,ledger,drain:async()=>{while(tasks.length)await tasks.shift()();}};
}

test('the content service runs as its own job: its own key and contract, the behaviour key untouched',async()=>{
 const c=service(CONTENT_CONTRACT,async()=>answer({hateful:true,quotes:[{evidenceId:'activity:p1',quote:'應該全部趕出去'}],targets:['族群']}));
 assert.equal(c.s.start(scan()).status,'processing');await c.drain();
 const r=c.s.inspect(scan());
 assert.equal(r.status,'ready');assert.deepEqual(r.result,{hateful:true,quotes:[{evidenceId:'activity:p1',quote:'應該全部趕出去'}],targets:['族群']});
 const b=service(BEHAVIOR_CONTRACT,async()=>{throw Error('not called');});
 const contentPlan=c.s.plan(scan()),behaviourPlan=b.s.plan(scan());
 assert.equal(contentPlan.contractVersion,'account-content-v1');assert.equal(behaviourPlan.contractVersion,'account-behavior-v1');
 assert.notEqual(contentPlan.key,behaviourPlan.key);
 assert.equal(b.s.inspect(scan()).status,'not_requested','the behaviour judgement is not answered by the content job');
 const unsure=service(CONTENT_CONTRACT,async()=>answer({hateful:true,quotes:[{evidenceId:'activity:p1',quote:'沒有這句'}],targets:['族群']}));
 unsure.s.start(scan());await unsure.drain();
 assert.deepEqual(unsure.s.inspect(scan()).result,{hateful:false,quotes:[],targets:[],unverified:true},'an unverifiable yes is shown as no');
 const none=service(CONTENT_CONTRACT,async()=>{throw Error('not called');});
 assert.equal(none.s.start({...scan(),posts:[],comments:[]}).status,'no_data','nothing written: no judgement, no spend');
});

// The data object runs both judgements from one start and must hand each queued job to the service that planned it:
// both use the same model, so routing by model alone would judge the content job with the behaviour contract.
function fakeStorage(){
 const db=new DatabaseSync(':memory:');
 return {sql:{exec(text,...params){const rows=db.prepare(text).all(...params);return {toArray:()=>rows,one:()=>rows[0]};}},
  transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},setAlarm(){},async get(){},async put(){},async delete(){}};
}
test('one start runs both judgements; each queued job is worked by its own contract',async()=>{
 const seen=[];
 const fetchImpl=async(url,options)=>{
  const body=JSON.parse(options.body),content=JSON.stringify(body).includes('高度仇恨言論');
  if(url.endsWith(':countTokens'))return {ok:true,status:200,json:async()=>({totalTokens:80})};
  seen.push(content?'content':'behaviour');
  return {ok:true,status:200,json:async()=>answer(content?{hateful:false,quotes:[],targets:[]}:{assessment:'no_clear_suspicious_behavior'})};
 };
 const env={WHOSPOST_APIFY_LIMIT_USD:'2',WHOSPOST_DAILY_LIMIT_USD:'0',WHOSPOST_AI_LIMIT_USD:'1',WHOSPOST_AI_ENABLED:'1',GEMINI_API_KEY:'fixture-key'};
 const core=new StoreObjectCore({storage:fakeStorage()},env,{prompt:'behaviour prompt',contentPrompt:PROMPT,fetchImpl});
 const s=core.store.create(NAME);core.store.update(s.id,{...scan(),id:s.id});
 const started=core.aiStart(s.id);
 assert.equal(started.result.status,'processing');assert.equal(started.content.status,'processing');
 await core.alarm();
 assert.deepEqual(seen.sort(),['behaviour','content']);
 const both=core.aiInspect(s.id);
 assert.equal(both.content.status,'ready');assert.deepEqual(both.content.result,{hateful:false,quotes:[],targets:[]});
 assert.equal(both.result.status,'invalid_output','the behaviour job was checked by the behaviour contract (this fixture answer is not a valid one)');
 const without=new StoreObjectCore({storage:fakeStorage()},env,{prompt:'behaviour prompt',fetchImpl});
 const t=without.store.create(NAME);without.store.update(t.id,{...scan(),id:t.id});
 assert.equal(without.aiInspect(t.id).content,null,'no content prompt: no content judgement, item 8 reads unknown');
});
