import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {AiStore} from './store.mjs';
import {AiService} from './service.mjs';
import {selectTransport} from './provider.mjs';
import {readSecret} from '../env-file.mjs';
const positive=(value,fallback)=>{const n=value===undefined?fallback:Number(value);if(!Number.isFinite(n)||n<=0)throw Error('Invalid AI limit');return n;};
export function readAiConfig(root,env=process.env){
 const enabled=env.WHOSPOST_AI_ENABLED==='1';
 // Optional: spending recorded before this ledger existed. When configured it must be readable,
 // so a missing file is never treated as free earlier usage.
 const previous=env.WHOSPOST_AI_BASELINE_LEDGER?resolve(root,env.WHOSPOST_AI_BASELINE_LEDGER):null;
 let baseline=previous?null:0;
 if(previous)try{const r=JSON.parse(readFileSync(previous,'utf8'));if(Number.isFinite(r.priorReservedUsd)&&Number.isFinite(r.estimatedNewUsageUsd)&&r.calls?.every(c=>c.status==='completed'&&c.usage))baseline=r.priorReservedUsd+r.estimatedNewUsageUsd;}catch{}
 return {enabled,limitUsd:env.WHOSPOST_AI_LIMIT_USD==='0'?null:positive(env.WHOSPOST_AI_LIMIT_USD,.10),maxOutputTokens:positive(env.WHOSPOST_AI_MAX_OUTPUT_TOKENS,1800),baselineCommittedUsd:baseline,ledgerPath:resolve(env.WHOSPOST_AI_LEDGER??resolve(root,'runtime/ai-account-ledger.sqlite'))};
}
export function createAiBackend(root,{env=process.env,fetchImpl=globalThis.fetch}={}){
 const config=readAiConfig(root,env);
 if(config.enabled&&config.baselineCommittedUsd===null)throw Error('Previous AI budget ledger is unavailable');
 const store=new AiStore(!config.enabled&&!existsSync(config.ledgerPath)?':memory:':config.ledgerPath,{limitUsd:config.limitUsd,baselineCommittedUsd:config.baselineCommittedUsd??0});
 const {transport,configured}=selectTransport(env,{readKey:name=>readSecret(name,env),fetchImpl});
 const service=new AiService({store,transport,prompt:readFileSync(resolve(root,'prompts/account-behavior.md'),'utf8'),enabled:config.enabled,configured:config.enabled&&configured,maxOutputTokens:config.maxOutputTokens});
 return {service,close:()=>store.close()};
}
