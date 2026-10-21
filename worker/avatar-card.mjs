// The 1080×1080 round avatar for a completed scan, as a satori element tree (rendered to PNG by og-render.mjs).
// Designed as a profile picture, not a report: a paper disc on a transparent background, the handle in a pill at
// the top, one huge number in the middle (what is still readable at 150 px), a short label under it, the AI
// line and the site name small at the bottom. Nothing is lost when Threads crops it to a circle. Kept free of the renderer so Node tests can check the
// layout data and the version without wasm. Same data source as the link preview (share-meta.mjs shareCard()).
const LAYOUT=4; // bump when the avatar design changes, so stored images and URLs move to the new look
const SIZE=1080,MAX_LEAD=22; // one line under the number
const INK='#303E49',MUTED='#56626A',PAPER='#FAF8F2',HIGHLIGHT='#F6E7A6',SOFT='#DDEBE6';
export const AVATAR_SITE='whospost.felixlai.workers.dev';
const clip=text=>text.length>MAX_LEAD?`${text.slice(0,MAX_LEAD-1)}…`:text;

/** Short content hash of the avatar (FNV-1a), so the image URL changes when the verdict or AI conclusion does. */
export function avatarVersion(card){
 let h=0x811c9dc5;
 for(const c of JSON.stringify([LAYOUT,card.username,card.headline,card.tone,card.hits??null,card.total??6,clip(card.lead),card.counts])){h^=c.charCodeAt(0);h=Math.imul(h,0x01000193)>>>0;}
 return h.toString(16).padStart(8,'0');
}

const el=(type,style,...children)=>({type,props:{style,children:children.length===1?children[0]:children}});
const usernameSize=name=>name.length>24?34:name.length>16?44:58;
const pill=(style,...children)=>el('div',{display:'flex',alignItems:'center',justifyContent:'center',background:'#ffffff',border:`4px solid ${INK}`,borderRadius:999,boxShadow:`5px 5px 0 ${INK}`,...style},...children);
const magnifier={type:'svg',props:{width:64,height:64,viewBox:'0 0 76 76',children:[
 {type:'circle',props:{cx:30,cy:30,r:20,fill:HIGHLIGHT,stroke:INK,strokeWidth:5}},
 {type:'path',props:{d:'M45 45 L66 66',stroke:INK,strokeWidth:8,strokeLinecap:'round'}},
 {type:'path',props:{d:'M21 24 Q30 16 38 22',stroke:'#ffffff',strokeWidth:4,strokeLinecap:'round',fill:'none'}}]}};
/** The middle of the disc: the number out of six, 0 with its own label, or a dashed blank when not enough data. */
function centre(card){
 const total=card.total??6,hits=card.hits??null;
 if(hits===null)return [
  el('div',{display:'flex',alignItems:'center',justifyContent:'center',width:300,height:300,border:`8px dashed ${MUTED}`,borderRadius:72,color:MUTED,fontSize:160,fontWeight:700},'—'),
  pill({marginTop:34,padding:'10px 34px',fontSize:44,fontWeight:700,color:MUTED,background:PAPER},'資料不足，暫不評分')];
 return [
  el('div',{display:'flex',alignItems:'flex-end'},
   el('div',{display:'flex',fontSize:400,fontWeight:700,lineHeight:0.86,letterSpacing:-18,color:INK},String(hits)),
   el('div',{display:'flex',marginLeft:14,marginBottom:8,fontSize:88,fontWeight:700,color:INK,letterSpacing:-2},`／${total}`)),
  pill({marginTop:24,padding:'10px 38px',fontSize:hits>0?48:40,fontWeight:700,background:hits>0?HIGHLIGHT:'#ffffff'},hits>0?'項值得注意':'未發現可疑行為')];
}
/** Satori element tree for a shareCard() result. */
export function avatarElement(card){
 return el('div',{display:'flex',position:'relative',width:SIZE,height:SIZE,background:'transparent',color:INK,fontFamily:'Noto Sans TC'},
  el('div',{display:'flex',position:'absolute',top:0,left:0,width:SIZE,height:SIZE,borderRadius:SIZE/2,background:PAPER,border:`8px solid ${INK}`}),
  el('div',{display:'flex',position:'absolute',top:150,left:0,width:SIZE,justifyContent:'center',alignItems:'center'},
   el('div',{display:'flex',alignItems:'center',justifyContent:'center',width:88,height:88,marginRight:22,background:HIGHLIGHT,border:`4px solid ${INK}`,borderRadius:22,boxShadow:`5px 5px 0 ${INK}`,transform:'rotate(-8deg)',fontSize:46,fontWeight:700,letterSpacing:-3,paddingRight:3},'w.'),
   pill({padding:'12px 40px',maxWidth:760,fontSize:usernameSize(card.username),fontWeight:700,letterSpacing:-1},`@${card.username}`)),
  el('div',{display:'flex',flexDirection:'column',alignItems:'center',position:'absolute',top:286,left:0,width:SIZE},...centre(card)),
  el('div',{display:'flex',position:'absolute',top:846,left:0,width:SIZE,justifyContent:'center',fontSize:30,lineHeight:1.3,color:INK},clip(card.lead)),
  el('div',{display:'flex',position:'absolute',top:912,left:0,width:SIZE,justifyContent:'center',fontSize:24,fontWeight:700,color:MUTED},`${card.counts}｜${AVATAR_SITE}`),
  el('div',{display:'flex',alignItems:'center',justifyContent:'center',position:'absolute',top:730,left:830,width:112,height:112,background:SOFT,border:`4px solid ${INK}`,borderRadius:56,boxShadow:`6px 6px 0 ${INK}`,transform:'rotate(8deg)'},magnifier));
}
