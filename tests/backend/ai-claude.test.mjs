import test from 'node:test';
import assert from 'node:assert/strict';
import {AiStore} from '../../server/ai/store.mjs';
import {AiService} from '../../server/ai/service.mjs';
import {claudeTransport,CLAUDE_PRICING} from '../../server/ai/claude.mjs';
import {selectTransport} from '../../server/ai/provider.mjs';
import {setLogSink} from '../../worker/log.mjs';
const scan=(name='fixture_claude')=>({id:'fixture-only',status:'completed',account:{username:name,name:'合成測試帳號',url:`https://www.threads.com/@${name}`},completedAt:'2026-10-18T00:00:00Z',posts:[{id:'p',author:name,kind:'post',text:'這是合成測試用的專案介紹，不是真實帳號資料。',postedAt:'2026-10-17T01:00:00Z',url:`https://www.threads.com/@${name}/post/fixture`}],comments:[]});
const output=plan=>{const e=plan.input.evidence[0];return {assessment:'no_clear_suspicious_behavior',conclusion:'本次內容提供專案介紹的脈絡，目前未見明確可疑模式。',findings:[{behavior:'具體專案介紹',judgment:'contextual',observation:'可見一則專案介紹文字。',interpretation:'內容本身提供具體主題，未顯示反覆灌入訊息的模式。',alternative:'可能具有個人宣傳目的，目前沒有更多活動可比對。',evidence:[{evidenceId:e.id,quote:e.text}],researchIds:['context']}],limitations:['合成資料只用於驗證API契約。']};};
const plan={model:'claude-haiku-5-5',body:{systemInstruction:{parts:[{text:'prompt'}]},contents:[{role:'user',parts:[{text:'input'}]}],generationConfig:{maxOutputTokens:1800}}};
const reply=(text,extra={})=>({id:'msg_1',model:'claude-haiku-5-5',stop_reason:'end_turn',content:[{type:'thinking',thinking:''},{type:'text',text}],usage:{input_tokens:1000,output_tokens:400,cache_creation_input_tokens:0,cache_read_input_tokens:0},...extra});
const fake=(handler)=>{const calls=[];return {calls,fetchImpl:async(url,options)=>{calls.push({url,options,body:JSON.parse(options.body)});const r=await handler(url,calls.at(-1).body);return r instanceof Response?r:Response.json(r);}};};

test('claude transport sends the Messages API request and returns a Gemini-shaped reply',async()=>{
 const f=fake((url,body)=>url.endsWith('/count_tokens')?{input_tokens:321}:reply('```json\n{"ok":true}\n```'));
 const t=claudeTransport({getApiKey:()=>'fixture-key',fetchImpl:f.fetchImpl});
 assert.equal(t.provider,'claude');assert.equal(t.model,'claude-haiku-5-5');assert.deepEqual(t.pricing,CLAUDE_PRICING['claude-haiku-5-5']);
 assert.equal(await t.count(plan),321);
 const raw=await t.generate(plan);
 assert.equal(f.calls[0].url,'https://api.anthropic.com/v1/messages/count_tokens');assert.equal(f.calls[1].url,'https://api.anthropic.com/v1/messages');
 for(const c of f.calls){assert.equal(c.options.headers['x-api-key'],'fixture-key');assert.equal(c.options.headers['anthropic-version'],'2023-06-01');assert.equal(c.body.model,'claude-haiku-5-5');assert.equal(c.body.system,'prompt');assert.deepEqual(c.body.messages,[{role:'user',content:'input'}]);}
 assert.equal(f.calls[1].body.max_tokens,1800);assert.equal(f.calls[0].body.max_tokens,undefined);
 assert.deepEqual(f.calls[1].body.thinking,{type:'disabled'});assert.deepEqual(f.calls[1].body.output_config,{effort:'low'});assert.equal(f.calls[0].body.thinking,undefined);
 assert.equal(raw.candidates[0].finishReason,'STOP');assert.equal(raw.candidates[0].content.parts[0].text,'{"ok":true}');
 assert.deepEqual(raw.usageMetadata,{promptTokenCount:1000,candidatesTokenCount:400});assert.equal(raw.modelVersion,'claude-haiku-5-5');
 assert.equal(JSON.stringify(raw).includes('fixture-key'),false);
});
test('claude transport maps provider failures to the shared error codes without leaking the body',async()=>{
 for(const [status,code] of [[401,'auth_failed'],[403,'auth_failed'],[429,'rate_limited'],[529,'rate_limited'],[500,'provider_failed']]){
  const t=claudeTransport({getApiKey:()=>'fixture-key',fetchImpl:async()=>new Response(JSON.stringify({error:{message:'secret detail'}}),{status})});
  await assert.rejects(()=>t.generate(plan),e=>e.message===code);
 }
 await assert.rejects(()=>claudeTransport({getApiKey:()=>'',fetchImpl:async()=>{throw Error('must not fetch');}}).generate(plan),e=>e.message==='not_configured');
 await assert.rejects(()=>claudeTransport({getApiKey:()=>'k',fetchImpl:async()=>{throw Error('offline');}}).count(plan),e=>e.message==='transport_failed');
 await assert.rejects(()=>claudeTransport({getApiKey:()=>'k',fetchImpl:async()=>new Response('not json',{status:200})}).generate(plan),e=>e.message==='invalid_provider_response');
 await assert.rejects(()=>claudeTransport({getApiKey:()=>'k',fetchImpl:async()=>Response.json({input_tokens:0})}).count(plan),e=>e.message==='invalid_token_count');
});
function service(t,handler,options={}){
 const ledger=new AiStore(':memory:',{limitUsd:options.limitUsd??.1});t.after(()=>ledger.close());
 const tasks=[],f=fake(handler);
 const svc=new AiService({store:ledger,transport:claudeTransport({getApiKey:()=>'fixture-key',fetchImpl:f.fetchImpl,model:options.model}),prompt:'fixture prompt',enabled:true,configured:true,schedule:fn=>tasks.push(fn)});
 return {ledger,svc,calls:f.calls,drain:async()=>{while(tasks.length)await Promise.all(tasks.splice(0).map(fn=>fn()));}};
}
test('service prices a Claude generation with the Claude table and logs claude.* events',async t=>{
 const lines=[],restore=setLogSink((level,line)=>lines.push(JSON.parse(line)));t.after(restore);
 let current;const f=service(t,(url,body)=>url.endsWith('/count_tokens')?{input_tokens:2000}:reply(JSON.stringify(output(current))));
 const s=scan();current=f.svc.plan(s);
 assert.equal(f.svc.capabilities().provider,'claude');assert.equal(f.svc.capabilities().model,'claude-haiku-5-5');
 f.svc.start(s);await f.drain();
 const r=f.svc.inspect(s);assert.equal(r.status,'ready');assert.equal(r.provenance.provider,'claude');assert.equal(r.provenance.model,'claude-haiku-5-5');
 // 1000 input × $0.10/M + 400 output × $0.50/M
 const attempt=f.ledger.db.prepare('SELECT reserved,actual FROM ai_attempts').get();
 assert.equal(attempt.actual,Math.ceil((1000*.10+400*.50)));assert.equal(attempt.reserved,Math.ceil((2000+2048)*.10+1800*.50));
 const generate=lines.find(l=>l.event==='claude.generate');assert.equal(generate.provider,'claude');assert.equal(generate.usd,(1000*.10+400*.50)/1e6);assert.equal(lines.some(l=>l.event.startsWith('gemini.')),false);
 // The Claude job has its own cache key: a Gemini-default service does not see it.
 const gemini=new AiService({store:f.ledger,transport:{count:async()=>1,generate:async()=>{throw Error('must not run');}},prompt:'fixture prompt'});
 assert.equal(gemini.inspect(s).status,'not_requested');assert.notEqual(gemini.plan(s).key,current.key);
});
test('a Claude reply cut off by max_tokens is kept privately and not shown',async t=>{
 const lines=[],restore=setLogSink((level,line)=>lines.push(JSON.parse(line)));t.after(restore);
 let current;const f=service(t,(url)=>url.endsWith('/count_tokens')?{input_tokens:100}:reply(JSON.stringify(output(current)).slice(0,80),{stop_reason:'max_tokens'}));
 const s=scan();current=f.svc.plan(s);f.svc.start(s);await f.drain();
 const r=f.svc.inspect(s);assert.equal(r.status,'invalid_output');assert.equal(r.result,null);
 assert.equal(f.ledger.get(r.cacheKey).raw.candidates[0].finishReason,'MAX_TOKENS');
 assert.match(lines.find(l=>l.event==='claude.invalid_output').reason,/MAX_TOKENS/);
 f.svc.start(s,{retry:true});await f.drain();assert.equal(f.calls.filter(c=>!c.url.endsWith('/count_tokens')).length,1);
});
test('a 429 from Claude is a retryable rejection that frees the reservation',async t=>{
 const f=service(t,(url)=>url.endsWith('/count_tokens')?{input_tokens:100}:new Response('{}',{status:429}));
 const s=scan();f.svc.start(s);await f.drain();
 const r=f.svc.inspect(s);assert.equal(r.status,'provider_rejected');assert.equal(r.retryAllowed,true);assert.equal(f.ledger.budget().committedUsd,0);
});
test('an unpriced Claude model cannot be run',()=>{
 assert.throws(()=>new AiService({store:{},transport:claudeTransport({getApiKey:()=>'k',model:'claude-opus-5-5'}),prompt:'p'}),/Unpriced/);
});
test('WHOSPOST_AI_PROVIDER selects the transport and the key that decides configured',async t=>{
 const lines=[],restore=setLogSink((level,line)=>lines.push(JSON.parse(line)));t.after(restore);
 const gem=selectTransport({GEMINI_API_KEY:'g'});assert.equal(gem.provider,'gemini');assert.equal(gem.transport.provider,undefined);assert.equal(gem.configured,true);
 assert.equal(selectTransport({WHOSPOST_AI_PROVIDER:'gemini',ANTHROPIC_API_KEY:'a'}).configured,false);
 const cl=selectTransport({WHOSPOST_AI_PROVIDER:'claude',ANTHROPIC_API_KEY:'a',GEMINI_API_KEY:'g'});assert.equal(cl.provider,'claude');assert.equal(cl.transport.model,'claude-haiku-5-5');assert.equal(cl.configured,true);
 assert.equal(selectTransport({WHOSPOST_AI_PROVIDER:'claude',GEMINI_API_KEY:'g'}).configured,false);
 const unpriced=selectTransport({WHOSPOST_AI_PROVIDER:'claude',ANTHROPIC_API_KEY:'a',WHOSPOST_AI_CLAUDE_MODEL:'claude-opus-5-5'});assert.equal(unpriced.configured,false);assert.doesNotThrow(()=>new AiService({store:{},transport:unpriced.transport,prompt:'p'}));
 const unknown=selectTransport({WHOSPOST_AI_PROVIDER:'openai',GEMINI_API_KEY:'g'});assert.equal(unknown.provider,'gemini');assert.equal(unknown.configured,false);
 assert.deepEqual(lines.map(l=>l.event),['ai.provider_unpriced','ai.provider_unknown']);
 // Node server reads the key through readKey, with the Gemini key-name override intact.
 const named=selectTransport({WHOSPOST_GEMINI_KEY_NAME:'MY_GEMINI'},{readKey:name=>({MY_GEMINI:'x'})[name]});assert.equal(named.configured,true);
});
