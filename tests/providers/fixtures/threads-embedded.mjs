// Synthetic Threads pages in the shape the logged-out probe of 2026-10-21 saw. Every id, text and timestamp is
// made up; the only account names are the project's test accounts (hkj315, hkj331155) and placeholders.
const T0=1760000000;
export const post=(code,user,i=0,extra={})=>({pk:`90${code.length}${i}${code.replace(/\W/g,'')}`.slice(0,19),code,user:{username:user,full_name:user==='hkj315'?'測試帳號':null},caption:{text:`第 ${i+1} 篇測試文字，內容與任何真實貼文無關。`},taken_at:T0-i*3600,like_count:i,text_post_app_info:{direct_reply_count:i%3,share_info:{}},...extra});
const thread=items=>({node:{thread_items:items.map(p=>({post:p}))}});
/** Profile page: `count` own posts, one with the owner's follow-up, one repost, then a stranger's post. */
export function profileHtml(user='hkj315',count=10){
 const edges=[];
 for(let i=0;i<count;i++)edges.push(thread(i===1?[post(`own${i}`,user,i),post(`follow${i}`,user,i+50)]:[post(`own${i}`,user,i)]));
 edges.push(thread([post('rep1',user,70,{text_post_app_info:{share_info:{reposted_post:{}}}})]));
 edges.push(thread([post('other1','user_a',71)]));
 const blob={require:[['x',null,null,[{__bbox:{require:[['y',null,null,[{__bbox:{result:{data:{mediaData:{edges,page_info:{has_next_page:true}},user:{username:user,full_name:user==='hkj315'?'測試帳號':null,follower_count:12,text_post_app_is_private:false}}}}}]]]}}]]]};
 return `<!DOCTYPE html><html><head><title>@${user}</title></head><body><script type="application/json" data-sjs>{"x":1}</script><script type="application/json" data-sjs>${JSON.stringify(blob)}</script></body></html>`;
}
/** Profile page laid out as the logged-out page of 2026-10-24 was (@zuck): the thread blob's post authors carry a name
 *  and the privacy flag but no follower count, and the owner's follower_count sits in a later blob with no thread data. */
export function profileSplitHtml(user='hkj315',count=10,followers=5753787){
 const edges=[];
 for(let i=0;i<count;i++)edges.push(thread([post(`own${i}`,user,i,{user:{username:user,full_name:'測試帳號',text_post_app_is_private:false}})]));
 const threads={data:{mediaData:{edges,page_info:{has_next_page:true}}}};
 const owner={require:[['z',null,null,[{__bbox:{result:{data:{user:{username:user,pk:'1',text_post_app_is_private:false,follower_count:followers,full_name:'測試帳號',is_verified:false}}}}}]]]};
 return `<html><body><script type="application/json" data-sjs>${JSON.stringify(threads)}</script><script type="application/json" data-sjs>{"unrelated":true}</script><script type="application/json" data-sjs>${JSON.stringify(owner)}</script></body></html>`;
}
/** Replies tab: `count` own replies under other people's posts, plus one reply under the owner's own post. */
export function repliesHtml(user='hkj315',count=4){
 const edges=[];
 for(let i=0;i<count;i++)edges.push(thread([post(`parent${i}`,i%2?'user_b':'hkj331155',i+20),post(`reply${i}`,user,i+30)]));
 edges.push(thread([post('ownparent',user,40),post('ownreply',user,41)]));
 const blob={data:{mediaData:{edges,page_info:{has_next_page:count>0}}}};
 return `<html><body><script type="application/json" data-sjs>${JSON.stringify(blob)}</script></body></html>`;
}
/** A GraphQL page the Replies tab loads when scrolled: `count` more own replies, ids disjoint from repliesHtml. */
export function repliesGraphql(user='hkj315',count=7){
 const edges=[];
 for(let i=0;i<count;i++)edges.push(thread([post(`gparent${i}`,'user_c',i+60),post(`greply${i}`,user,i+80)]));
 return `for (;;);${JSON.stringify({data:{mediaData:{edges,page_info:{has_next_page:false}}}})}`;
}
/** A post page: `count` direct replies by other accounts. */
export function postPageHtml(count=3){
 const blob={data:{direct_replies:{edges:Array.from({length:count},(_,i)=>({node:{posts:{edges:[{node:post(`c${i}`,`commenter_${i}`,i+100)}]}}})),page_info:{has_next_page:count>2}}}};
 return `<html><body><script type="application/json" data-sjs>${JSON.stringify(blob)}</script></body></html>`;
}
/** The login wall: a page without any embedded thread data. */
export const loginHtml='<html><body><form><input name="username"><input type="password"></form></body></html>';
