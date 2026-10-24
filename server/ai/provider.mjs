import {geminiTransport} from './gemini.mjs';
import {claudeTransport,CLAUDE_PRICING,DEFAULT_CLAUDE_MODEL} from './claude.mjs';
import {log} from '../../worker/log.mjs';
export const PROVIDERS=['gemini','claude'];
/**
 * Picks the AI transport from WHOSPOST_AI_PROVIDER ("gemini", the default, or "claude") and says whether its key is
 * present. readKey(name) returns the secret for that name. An unknown provider or an unpriced Claude model never
 * throws (the data Durable Object constructs this): it falls back to Gemini with configured=false and logs once.
 */
export function selectTransport(env,{readKey=name=>env[name],fetchImpl=globalThis.fetch}={}){
 const provider=(env.WHOSPOST_AI_PROVIDER||'gemini').toLowerCase();
 if(provider==='claude'){
  const model=env.WHOSPOST_AI_CLAUDE_MODEL||DEFAULT_CLAUDE_MODEL;
  if(!CLAUDE_PRICING[model]){log('error','ai.provider_unpriced',{provider,model});return {provider:'claude',transport:claudeTransport({getApiKey:()=>readKey('ANTHROPIC_API_KEY'),fetchImpl}),configured:false};}
  return {provider,transport:claudeTransport({getApiKey:()=>readKey('ANTHROPIC_API_KEY'),fetchImpl,model}),configured:!!readKey('ANTHROPIC_API_KEY')};
 }
 if(provider!=='gemini')log('error','ai.provider_unknown',{provider});
 const geminiKey=()=>readKey(env.WHOSPOST_GEMINI_KEY_NAME||'GEMINI_API_KEY');
 return {provider:'gemini',transport:geminiTransport({getApiKey:geminiKey,fetchImpl}),configured:provider==='gemini'&&!!geminiKey()};
}
