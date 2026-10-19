// GA4 thin wrapper. gtag loads only when /api/health returns a valid Measurement ID (production only);
// without one every call is a no-op. Only the enumerated params below are sent: never the scanned account,
// scan ID, full URL, IP or email. Tracking errors are swallowed so they never reach the visitor's flow.
const MEASUREMENT_ID=/^G-[A-Z0-9]{6,}$/,SOURCE=/^[a-z0-9_-]{1,32}$/,MAX_QUEUED=30;

/** API answer to POST /api/scans → scan_submit outcome. */
export function scanOutcome(status,code){
 if(status===202)return 'started';
 if(status===200)return 'cached';
 if(status===429)return code==='RATE_LIMITED'?'rate_limited':'quota';
 if(status===403)return 'turnstile_failed';
 if(status===503)return 'paused';
 return 'error';
}
/** Current page address with every query parameter except utm_* removed. */
export function pageLocation({origin,pathname,search}){
 const keep=new URLSearchParams();for(const [k,v] of new URLSearchParams(search))if(/^utm_[a-z]+$/.test(k))keep.append(k,v);
 const query=keep.toString();return `${origin}${pathname}${query?`?${query}`:''}`;
}
/** What the visitor typed: a profile link, @handle or a bare username. */
export const inputType=raw=>{const text=String(raw??'').trim();return text.startsWith('@')?'handle':/[/.]/.test(text)&&/threads\./i.test(text)?'link':'bare';};

export function createAnalytics({win,doc,storage,search=''}={}){
 let state='pending',common={page_type:'home'};const queue=[],seen=new Set();
 const read=key=>{try{return storage?.getItem(key)??null}catch{return null}};
 const write=(key,value)=>{try{storage?.setItem(key,value)}catch{}};
 // entry_source counts only the first landing of the browser session.
 let entry=read('whospost.entry');
 if(entry===null){const from=new URLSearchParams(search).get('from');entry=from&&SOURCE.test(from)?from:'';write('whospost.entry',entry);}
 if(entry)common.entry_source=entry;
 const send=(name,params)=>{try{win.gtag('event',name,{...common,...params})}catch{}};
 return {
  init(id){
   if(state!=='pending')return;
   if(typeof id!=='string'||!MEASUREMENT_ID.test(id)){state='off';queue.length=0;return;}
   try{
    win.dataLayer=win.dataLayer||[];
    win.gtag=function(){win.dataLayer.push(arguments)};
    win.gtag('js',new Date());
    // page_location keeps only utm_* so a shared ?scan= ID never leaves the site but campaign sources still count.
    win.gtag('config',id,{page_location:pageLocation(win.location)});
    const script=doc.createElement('script');script.async=true;script.src=`https://www.googletagmanager.com/gtag/js?id=${id}`;doc.head.appendChild(script);
    state='on';
   }catch{state='off';}
   for(const [name,params] of queue.splice(0))if(state==='on')send(name,params);
  },
  setPageType(type){common={...common,page_type:type};},
  track(name,params={}){
   if(state==='off')return;
   if(state==='pending'){if(queue.length<MAX_QUEUED)queue.push([name,params]);return;}
   send(name,params);
  },
  /** Once per browser session for this key; the key itself is never sent. */
  trackOnce(key,name,params){
   const k=`whospost.once.${key}`;if(seen.has(k)||read(k))return;seen.add(k);write(k,'1');this.track(name,params);
  },
  get enabled(){return state==='on';}
 };
}

const storage=(()=>{try{return globalThis.sessionStorage}catch{return null}})();
export const analytics=createAnalytics(typeof window==='undefined'?{}:{win:window,doc:document,storage,search:location.search});
