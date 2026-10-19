// What a running scan can show before analysis: posts and replies as each job finishes.
// null means that job has not finished; an empty list means it finished with nothing to show.
// Neither is scored, and missing data is never shown as "nothing found".
export const partialText={
 postsLoading:'發文讀取中…',
 commentsLoading:'留言讀取中…',
 postsEmpty:'這次沒有取得可顯示的發文。缺少資料不代表低風險，完成後會說明原因。',
 commentsEmpty:'這次沒有取得可顯示的本人留言。缺少資料不代表低風險，完成後會說明原因。',
 score:'分析完成後才評分',
 ai:'發文與留言都讀完、分析完成後，才會開始 AI 判讀。'
};
const list=x=>Array.isArray(x)?x:null;
export function partialView(scan){
 if(!scan||!['queued','running'].includes(scan.status)||typeof scan.account?.username!=='string')return null;
 const p=scan.partial&&typeof scan.partial==='object'?scan.partial:{};
 const posts=list(p.posts),comments=list(p.comments);
 return {account:{username:scan.account.username,url:scan.account.url,name:p.account?.name??scan.account.name??null},posts,comments,summary:partialSummary(posts,comments)};
}
export function partialSummary(posts,comments){
 if(!posts&&!comments)return '正在讀取發文與留言…';
 if(!comments)return `已取得 ${posts.length} 篇貼文，${partialText.commentsLoading}`;
 if(!posts)return `已取得 ${comments.length} 則留言，${partialText.postsLoading}`;
 return `已取得 ${posts.length} 篇貼文、${comments.length} 則留言，正在分析…`;
}
