// Threads answers in the shape measured logged in on 2026-10-24 (extension/docs/profile-lookup.md), with made-up
// accounts and values. The dialog's layout keys are obfuscated single characters in the real answer; these use the
// same kind of keys so the parser cannot lean on them.
export const hovercard=({username='user01',pk='1234567890',followers=1234,isPrivate=false}={})=>`for (;;);${JSON.stringify({data:{user:{strong_id__:pk,pk,id:pk,username,full_name:'User One',follower_count:followers,text_post_app_is_private:isPrivate,is_verified:false,biography:'fixture'}},extensions:{is_final:true},status:'ok'})}`;
export const hovercardMissing=()=>`for (;;);${JSON.stringify({data:{user:null},extensions:{is_final:true},status:'ok'})}`;
const text=(t,weight='normal')=>({'㐗':{')':t,'-':'14sp','.':weight},'㐵':{$:'#FF000000','#':'#FFF5F5F5'}});
const row=(label,value)=>({'㐈':{')':'column','6':'4dp'},children:[text(label,'semibold'),...(value===null?[]:[text(value)])]});
/** The dialog: rows in order (名稱, 已加入, optional 先前的用戶名稱, 所在地點); the country lives in the page-state keys. */
export function about({joined='2026年9月 · #301,234,567',country='台灣',shared=true,former=null,labels='zh',drop=[]}={}){
 const L=labels==='zh'?{name:'名稱',joined:'已加入',former:'先前的用戶名稱',based:'所在地點'}:{name:'Name',joined:'Joined',former:'Former usernames',based:'Based in'};
 const rows=[row(L.name,'User One（@user01'),row(L.joined,joined)];
 if(former!==null)rows.push(row(L.former,former));
 rows.push(row(L.based,')'));
 const kept=rows.filter((r,i)=>!drop.includes(i));
 const data=[{id:'c1',type:'gs',data:{key:'THREADS_ABOUT_THIS_PROFILE:about_this_profile_country_visibility',mode:'p',initial:shared}},{id:'c2',type:'gs',data:{key:'THREADS_ABOUT_THIS_PROFILE:about_this_profile_country',mode:'p',initial:country}}];
 return `for (;;);${JSON.stringify({__ar:1,rid:'fixture',payload:{layout:{bloks_payload:{data,embedded_payloads:[{id:'c3',payload:{layout:{bloks_payload:{tree:{'㐈':{')':'column'},children:kept}}}}}],props:[{id:'1',name:'ttrc_instance_id'}],error_attribution:{},action:'(dok (dnh "c3"))'}}}})}`;
}
/** Inline scripts of a signed-in page, with the three tokens where Threads keeps them; and its cookies. */
export const BKV='a'.repeat(64);
export const pageScripts=({dtsg='DTSGfixture:1',lsd='LSDfixture',bkv=BKV}={})=>`require("x");["DTSGInitialData",[],{"token":"${dtsg}"},258],["LSD",[],{"token":"${lsd}"},323],["WebBloksVersioningID",[],{"versioningID":"${bkv}"},4763]`;
export const COOKIE='mid=fixture; csrftoken=CSRFfixture; ds_user_id=42; dpr=2';
export const COOKIE_SIGNED_OUT='mid=fixture; csrftoken=CSRFfixture; dpr=2';
