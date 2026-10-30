// Fixtures for lib/replies.mjs in the shapes measured on Dia 2026-10-29/30 (probe-extension-replies rounds 2–5): the
// Replies-tab GraphQL answer (data.mediaData.edges[].node.thread_items[].post, page_info) and the logged-out post page
// of one reply (data-sjs JSON with the reply under `media` and the thread under `containing_thread`). Post ids and
// codes agree the way Threads' do (shared/reply-rows.mjs: the code is the id in base 64, the id carries the second).
const ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const EPOCH_MS=1314220021721;
/** The id of a post made at `ms` (n tells posts of the same second apart), as a decimal string. */
export const idAt=(ms,n=1)=>((BigInt(ms-EPOCH_MS)<<23n)+BigInt(n)).toString();
/** Its code. */
export function codeOf(id){let n=BigInt(id),s='';while(n>0n){s=ALPHABET[Number(n%64n)]+s;n/=64n;}return s;}
export const codeAt=(ms,n=1)=>codeOf(idAt(ms,n));
/** One post node. `reply`: the author this post replies to (null = a thread's opening post); `hidden`: Threads shows
 *  the reply but not its parent (parent_post_unavailable_reason, no reply_to_author). */
export function post({username,ms,n=1,text='',reply=null,hidden=false,quote=false,repost=false,extra={}}){
 const id=idAt(ms,n);
 const info={direct_reply_count:0,is_reply:Boolean(reply||hidden),reply_to_author:hidden||!reply?null:{username:reply,id:'1'},parent_post_unavailable_reason:hidden?'default':null,share_info:{quoted_post:quote?{pk:'1'}:null,reposted_post:repost?{pk:'2'}:null}};
 return {pk:id,id:`${id}_1`,code:codeOf(id),user:{username,pk:'99',is_verified:false},caption:{text},taken_at:Math.floor(ms/1000),like_count:0,text_post_app_info:info,...extra};
}
/** The Replies-tab answer: one thread per entry of `threads` (each a list of post nodes in order), with page info and
 *  optionally the `errors` Threads adds beside usable data. */
export function repliesBody(threads,{hasNext=true,errors=null}={}){
 const body={data:{mediaData:{edges:threads.map(items=>({node:{id:`thread_${items[0]?.pk??'0'}`,thread_items:items.map(p=>({post:p,line_type:'line',view_replies_cta_string:null}))},cursor:'c'})),page_info:{has_next_page:hasNext,end_cursor:hasNext?'QVFB...':null,has_previous_page:false,start_cursor:null}}},extensions:{is_final:true}};
 if(errors)body.errors=errors;
 return JSON.stringify(body);
}
export const EXECUTION_ERROR=[{message:'execution error',severity:'ERROR',path:['_on_Query_mediaData_on_XDTUserTextPostsResponseConnection_edges_node_on_XDTThread_thread_items_on_XDTThreadItem_post',11,'node','text_post_app_info','share_info']}];
/** The logged-out post page of `reply`, carrying its thread (`thread`: post nodes in order, the reply among them). A
 *  page for a reply whose parent is gone carries the reply alone with reply_to_author null. */
export function postPageHtml(reply,thread,{wall=false}={}){
 if(wall)return '<!doctype html><html><head><title>Login • Threads</title></head><body><script type="application/json" data-sjs>{"require":[]}</script></body></html>';
 const blob={require:[['ScheduledServerJS','handle',null,[{__bbox:{require:[['RelayPrefetchedStreamCache','next',[],['adp_BarcelonaPostPageQueryRelayPreloader_x',{__bbox:{complete:true,result:{data:{data:{edges:[{node:{thread_items:[{post:reply}]}}]},media:reply,containing_thread:{id:'t',posts:{edges:thread.map(p=>({node:p}))}}}}}}]]]}}]]]};
 return `<!doctype html><html><head><title>${reply.user.username} on Threads</title><meta property="og:url" content="https://www.threads.com/@${reply.user.username}/post/${reply.code}"></head><body><script type="application/json" data-content-len="1" data-sjs>${JSON.stringify(blob)}</script></body></html>`;
}
