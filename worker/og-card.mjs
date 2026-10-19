// The 1200×630 link-preview card for a shared scan, as a satori element tree (rendered to PNG by og-render.mjs).
// Kept free of the renderer so Node tests can check the layout data and the version without wasm.
const LAYOUT=1; // bump when the card design changes, so cached images and preview URLs move to the new look
const MAX_LEAD=84;
const TONE={hit:'#ef5a5a',clear:'#5ec98a',unknown:'#8b949e'};
const clip=text=>text.length>MAX_LEAD?`${text.slice(0,MAX_LEAD-1)}…`:text;

/** Short content hash of the card (FNV-1a), so the image URL changes when the verdict or AI conclusion does. */
export function cardVersion(card){
 let h=0x811c9dc5;
 for(const c of JSON.stringify([LAYOUT,card.username,card.headline,card.tone,clip(card.lead),card.counts])){h^=c.charCodeAt(0);h=Math.imul(h,0x01000193)>>>0;}
 return h.toString(16).padStart(8,'0');
}

const el=(type,style,...children)=>({type,props:{style,children:children.length===1?children[0]:children}});
/** Satori element tree for a shareCard() result. */
export function cardElement(card){
 return el('div',{display:'flex',flexDirection:'column',justifyContent:'space-between',width:1200,height:630,padding:'64px 72px',background:'#15191e',color:'#ffffff',fontFamily:'Noto Sans TC'},
  el('div',{display:'flex',alignItems:'center'},
   el('div',{display:'flex',alignItems:'center',justifyContent:'center',width:56,height:56,borderRadius:12,background:'#ffffff',color:'#15191e',fontSize:28,fontWeight:700},'w.'),
   el('div',{display:'flex',marginLeft:16,fontSize:32,fontWeight:700},'whospost')),
  el('div',{display:'flex',flexDirection:'column'},
   el('div',{display:'flex',fontSize:card.username.length>18?56:72,fontWeight:700},`@${card.username}`),
   el('div',{display:'flex',marginTop:12,fontSize:48,fontWeight:700,color:TONE[card.tone]??TONE.unknown},card.headline),
   el('div',{display:'flex',marginTop:28,fontSize:32,fontWeight:400,color:'#c9d1d9',lineHeight:1.4},clip(card.lead))),
  el('div',{display:'flex',fontSize:26,fontWeight:400,color:'#8b949e'},`${card.counts}｜Threads 帳號行為檢查`));
}
