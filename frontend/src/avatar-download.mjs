// "Download your avatar": fetches the 1080×1080 card for a finished scan and hands it to the device the way
// that works there. Three routes, in order: the share sheet (phones: iOS "Save Image", Android "Save to
// gallery"), a download link (desktop browsers), or opening the PNG itself for a long-press save (in-app
// browsers such as Threads', which ignore download links and blob: URLs). Pure functions take their browser
// pieces as arguments so Node tests can drive every route.
export const avatarUrl=(origin,scanId)=>`${origin}/api/avatar/${encodeURIComponent(scanId)}.png`;
export const avatarFileName=username=>`whospost-@${String(username??'').replace(/[^\w.-]+/g,'_')||'account'}.png`;
/** GA state: a numeric score (0 counts) or not enough data to score. */
export const avatarState=score=>typeof score?.value==='number'&&Number.isFinite(score.value)?'scored':'unscored';
/** In-app browsers: Threads ("Barcelona"), Instagram, Facebook, LINE, Android WebView, and iOS WKWebView (no Safari token). */
export function isWebView(ua=''){
 if(/Barcelona|Instagram|FBAN|FBAV|Line\/|; wv\)/i.test(ua))return true;
 return /iPhone|iPad|iPod/.test(ua)&&/AppleWebKit/.test(ua)&&!/Safari\//.test(ua);
}
export const pickMethod=({canShare,webView})=>canShare?'share':webView?'open':'download';

/** Runs the download. Returns {result, method, openUrl}: result is 'success' or 'fail'; openUrl is the pinned
 *  image address for a manual "open and long-press" fallback. A share sheet the visitor dismissed still counts
 *  as success, because browsers do not tell the two apart. */
export async function downloadAvatar({url,fileName,fetchImpl,nav,win,doc,ua}){
 let openUrl=url,method;
 try{
  const response=await fetchImpl(url,{cache:'no-store'});
  if(!response.ok)throw Object.assign(new Error(`avatar ${response.status}`),{status:response.status});
  const blob=await response.blob(),version=response.headers.get('x-avatar-version');
  if(version)openUrl=`${url}?v=${version}`;
  const file=typeof File==='function'?new File([blob],fileName,{type:'image/png'}):null;
  let canShare=false;try{canShare=Boolean(file&&nav?.share&&nav.canShare?.({files:[file]}));}catch{canShare=false;}
  method=pickMethod({canShare,webView:isWebView(ua)});
  if(method==='share'){
   try{await nav.share({files:[file],title:'Whospost 專屬頭貼'});return {result:'success',method,openUrl};}
   catch(error){if(error?.name==='AbortError')return {result:'success',method,openUrl};method='open';}
  }
  if(method==='download'){
   const href=win.URL.createObjectURL(blob),a=doc.createElement('a');
   a.href=href;a.download=fileName;a.rel='noopener';doc.body.appendChild(a);a.click();a.remove();
   win.setTimeout(()=>win.URL.revokeObjectURL(href),60000);
   return {result:'success',method,openUrl};
  }
  if(!win.open(openUrl,'_blank','noopener'))win.location.assign(openUrl);
  return {result:'success',method:'open',openUrl};
 }catch(error){return {result:'fail',method,openUrl,error};}
}
