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
/** The friendships dialog's counts (BarcelonaFriendshipsDialogUserQuery), as measured: data.counts beside data.user. */
export const counts=({followers=1234,following=480}={})=>`for (;;);${JSON.stringify({data:{user:{username:'user01',id:'1'},counts:{total_followers_count:followers,total_following_count:following}},extensions:{is_final:true}})}`;
/** One page of the 「追蹤中」 tab: the first page sits under data.user, the next ones under data.fetch__XDTUserDict.
 *  `users` are [username, youFollow] pairs; `next` the offset cursor ("20", "40") or null at the end. */
export function followingPage({users=[],next=null,more=false}={}){
 const following={edges:users.map(([username,youFollow=false],i)=>({node:{profile_pic_url:'https://example.invalid/p.jpg',friendship_status:{followed_by:false,following:youFollow,outgoing_request:false},pk:String(9000+i),username,full_name:`Name ${i}`,follower_count:10,is_verified:false,id:String(9000+i),__typename:'XDTUserDict'},cursor:null})),page_info:{end_cursor:next,has_next_page:next!==null,has_previous_page:false,start_cursor:null}};
 return `for (;;);${JSON.stringify({data:more?{fetch__XDTUserDict:{strong_id__:'1',following,id:'1'}}:{user:{strong_id__:'1',following,id:'1',fbid_v2:'1'}},extensions:{is_final:true}})}`;
}
/** Which of the GraphQL queries a request body is. */
export const friendlyName=body=>new URLSearchParams(body).get('fb_api_req_friendly_name');
