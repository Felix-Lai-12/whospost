// Anthropic Messages API transport. AiService builds one Gemini-shaped plan (systemInstruction, contents,
// generationConfig); this transport translates it to a Messages request and translates the reply back to the
// Gemini response shape (candidates[0].finishReason / content.parts, usageMetadata, modelVersion), so the ledger,
// the output checks and the stored raw rows stay the same whichever provider answered.
// Pricing is Anthropic's first-party list price in USD per 1M tokens, as published on
// https://platform.claude.com/docs/en/about-claude/pricing (read 2026-10-06; Haiku 5.5 rate for prompts up to
// 100K tokens, far above this service's 500 KB input cap). A model missing here has no price, so the service
// refuses to run it rather than guess: WHOSPOST_AI_LIMIT_USD is enforced with these numbers.
export const CLAUDE_PRICING={
 'claude-haiku-5-5':{inputUsdPerM:.10,outputUsdPerM:.50,pricedAt:'2026-10-06'}
};
export const DEFAULT_CLAUDE_MODEL='claude-haiku-5-5';
const API='https://api.anthropic.com/v1/messages';
const text=parts=>(parts??[]).map(p=>p.text??'').join('');
// Gemini finishReason vocabulary: the output check only accepts STOP.
const FINISH={end_turn:'STOP',stop_sequence:'STOP',max_tokens:'MAX_TOKENS',refusal:'SAFETY'};
// The model is asked for a bare JSON object; a fenced ```json block is still that object.
const unfence=s=>{const m=String(s).trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u);return m?m[1]:String(s).trim();};
export function claudeTransport({getApiKey,fetchImpl=globalThis.fetch,model=DEFAULT_CLAUDE_MODEL,timeoutMs=55000}){
 const pricing=CLAUDE_PRICING[model]??null;
 const request=body=>({model,system:text(body.systemInstruction?.parts),messages:[{role:'user',content:text(body.contents?.[0]?.parts)}]});
 async function post(path,payload){
  const key=await getApiKey();if(!key)throw Error('not_configured');
  let response;
  try{response=await fetchImpl(API+path,{method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify(payload),signal:AbortSignal.timeout(timeoutMs)});}catch{throw Error('transport_failed');}
  // 429 and 529 (overloaded) are refused before processing and not billed, so they are retryable like Gemini's 429.
  if(!response.ok)throw Error(response.status===401||response.status===403?'auth_failed':response.status===429||response.status===529?'rate_limited':'provider_failed');
  try{return await response.json();}catch{throw Error('invalid_provider_response');}
 }
 return {
  provider:'claude',model,modelRevision:model,pricing,
  async count({body}){const r=await post('/count_tokens',request(body));if(!Number.isSafeInteger(r.input_tokens)||r.input_tokens<1)throw Error('invalid_token_count');return r.input_tokens;},
  async generate({body}){
   // Haiku 5.5 thinks by default and counts it toward max_tokens; low effort keeps the budget for the answer.
   const r=await post('',{...request(body),max_tokens:body.generationConfig?.maxOutputTokens??1800,output_config:{effort:'low'}});
   const u=r.usage??{};
   const prompt=(u.input_tokens??0)+(u.cache_creation_input_tokens??0)+(u.cache_read_input_tokens??0);
   return {
    modelVersion:r.model??model,provider:'claude',
    candidates:[{finishReason:FINISH[r.stop_reason]??String(r.stop_reason??'UNKNOWN').toUpperCase(),content:{parts:[{text:unfence((r.content??[]).filter(b=>b.type==='text').map(b=>b.text).join(''))}]}}],
    usageMetadata:u.input_tokens===undefined?undefined:{promptTokenCount:prompt,candidatesTokenCount:u.output_tokens??0},
    providerResponse:{id:r.id,stop_reason:r.stop_reason,stop_details:r.stop_details??null,usage:r.usage??null}
   };
  }
 };
}
