// The 1080×1080 round "paper card" avatar for a completed scan, as a satori element tree (rendered to PNG by
// og-render.mjs). The image itself is a paper disc on a transparent background, so it looks like a sticker
// wherever it is saved and nothing is lost when Threads crops it to a circle. Kept free of the renderer so Node tests can check the
// layout data and the version without wasm. Same data source as the link preview (share-meta.mjs shareCard()).
const LAYOUT=2; // bump when the avatar design changes, so stored images and URLs move to the new look
const SIZE=1080,MAX_LEAD=40; // two lines of 20 full-width characters inside the card
const INK='#303E49',MUTED='#56626A',PAPER='#FAF8F2',HIGHLIGHT='#F6E7A6',SOFT='#DDEBE6';
export const AVATAR_NOTE='規則檢查清單，非網軍認定';
export const AVATAR_SITE='whospost.felixlai.workers.dev';
const clip=text=>text.length>MAX_LEAD?`${text.slice(0,MAX_LEAD-1)}…`:text;

/** Short content hash of the avatar (FNV-1a), so the image URL changes when the verdict or AI conclusion does. */
export function avatarVersion(card){
 let h=0x811c9dc5;
 for(const c of JSON.stringify([LAYOUT,card.username,card.headline,card.tone,card.hits??null,card.total??6,clip(card.lead),card.counts])){h^=c.charCodeAt(0);h=Math.imul(h,0x01000193)>>>0;}
 return h.toString(16).padStart(8,'0');
}

const el=(type,style,...children)=>({type,props:{style,children:children.length===1?children[0]:children}});
const usernameSize=name=>name.length>24?36:name.length>18?44:60;
/** The big-number block: N／6 項, 0 with "未發現可疑行為", or a dashed blank when there was not enough data. */
function scoreBlock(card){
 const total=card.total??6,hits=card.hits??null;
 if(hits===null)return el('div',{display:'flex',alignItems:'center'},
  el('div',{display:'flex',alignItems:'center',justifyContent:'center',width:170,height:170,border:`5px dashed ${MUTED}`,borderRadius:28,color:MUTED,fontSize:84,fontWeight:700},'—'),
  el('div',{display:'flex',flexDirection:'column',marginLeft:28,color:MUTED,fontSize:38,fontWeight:700,lineHeight:1.35},el('div',{display:'flex'},'資料不足'),el('div',{display:'flex'},'暫不評分')));
 return el('div',{display:'flex',alignItems:'flex-end'},
  el('div',{display:'flex',fontSize:220,fontWeight:700,lineHeight:1,letterSpacing:-8,color:INK},String(hits)),
  el('div',{display:'flex',flexDirection:'column',marginLeft:18,paddingBottom:22,color:INK,lineHeight:1.3},
   el('div',{display:'flex',fontSize:40,fontWeight:700},`／${total} 項`),
   el('div',{display:'flex',fontSize:hits>0?32:28,fontWeight:700},hits>0?'值得注意':'未發現可疑行為')));
}
const magnifier={type:'svg',props:{width:76,height:76,viewBox:'0 0 76 76',children:[
 {type:'circle',props:{cx:30,cy:30,r:20,fill:HIGHLIGHT,stroke:INK,strokeWidth:5}},
 {type:'path',props:{d:'M45 45 L66 66',stroke:INK,strokeWidth:8,strokeLinecap:'round'}},
 {type:'path',props:{d:'M21 24 Q30 16 38 22',stroke:'#ffffff',strokeWidth:4,strokeLinecap:'round',fill:'none'}}]}};
/** Satori element tree for a shareCard() result. */
export function avatarElement(card){
 return el('div',{display:'flex',position:'relative',width:SIZE,height:SIZE,background:'transparent',color:INK,fontFamily:'Noto Sans TC'},
  el('div',{display:'flex',position:'absolute',top:0,left:0,width:SIZE,height:SIZE,borderRadius:SIZE/2,background:PAPER,border:`6px solid ${INK}`}),
  el('div',{display:'flex',position:'absolute',top:118,left:0,width:SIZE,justifyContent:'center',fontSize:28,fontWeight:700,letterSpacing:3,color:MUTED},'Threads 帳號行為檢查'),
  el('div',{display:'flex',flexDirection:'column',position:'absolute',top:230,left:180,width:720,height:620,padding:'64px 52px 44px',background:'#ffffff',border:`4px solid ${INK}`,borderRadius:48,boxShadow:`12px 12px 0 ${INK}`},
   el('div',{display:'flex',fontSize:usernameSize(card.username),fontWeight:700,lineHeight:1.2,letterSpacing:-1},`@${card.username}`),
   el('div',{display:'flex',marginTop:18},scoreBlock(card)),
   el('div',{display:'flex',marginTop:22,fontSize:30,lineHeight:1.5,fontWeight:400,color:INK,wordBreak:'break-all'},clip(card.lead)),
   el('div',{display:'flex',marginTop:'auto',fontSize:24,color:MUTED},card.counts)),
  el('div',{display:'flex',alignItems:'center',justifyContent:'center',position:'absolute',top:176,left:156,width:104,height:104,background:HIGHLIGHT,border:`4px solid ${INK}`,borderRadius:26,boxShadow:`6px 6px 0 ${INK}`,transform:'rotate(-8deg)',fontSize:52,fontWeight:700,letterSpacing:-3,paddingRight:4},'w.'),
  el('div',{display:'flex',alignItems:'center',justifyContent:'center',position:'absolute',top:742,left:802,width:136,height:136,background:SOFT,border:`4px solid ${INK}`,borderRadius:68,boxShadow:`6px 6px 0 ${INK}`,transform:'rotate(8deg)'},magnifier),
  el('div',{display:'flex',flexDirection:'column',alignItems:'center',position:'absolute',top:876,left:0,width:SIZE,fontSize:26,lineHeight:1.3,color:MUTED},
   el('div',{display:'flex'},AVATAR_NOTE),el('div',{display:'flex',fontWeight:700},AVATAR_SITE)));
}
