// No credential lookup until explicitly enabled service dispatches a request.
export function geminiTransport({getApiKey,fetchImpl=globalThis.fetch,timeoutMs=55000}){
 async function post(model,method,body){
  const key=await getApiKey();if(!key)throw Error('not_configured');
  let response;
  try{response=await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${method}`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)});}catch{throw Error('transport_failed');}
  if(!response.ok)throw Error(response.status===401||response.status===403?'auth_failed':response.status===429?'rate_limited':'provider_failed');
  try{return await response.json();}catch{throw Error('invalid_provider_response');}
 }
 return {
  async count({model,body}){const parts=[...body.systemInstruction.parts,...body.contents[0].parts];const r=await post(model,'countTokens',{contents:[{role:'user',parts}]});if(!Number.isSafeInteger(r.totalTokens)||r.totalTokens<1)throw Error('invalid_token_count');return r.totalTokens;},
  generate:({model,body})=>post(model,'generateContent',body)
 };
}
