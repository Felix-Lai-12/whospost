// Synthetic negative controls for shared/signals.mjs. Every account here is invented (@demo.*); none is a real
// Threads user. Each one is an ordinary behaviour that trips exactly one rule, so a threshold change that
// flags more of them shows up as a failing regression test. Texts are varied on purpose so the fixtures do not
// look like templates to the repetition rules themselves.
const at=(day,hour,minute,second=0)=>new Date(Date.UTC(2026,9,day,hour,minute,second)).toISOString();
const post=(username,i,text,postedAt)=>({id:`p${i}`,kind:'post',author:username,text,postedAt,url:`https://www.threads.com/@${username}/post/${username.replace(/\W/g,'')}p${i}`,parentUrl:null,isQuote:false,isRepost:false});
const reply=(username,i,text,parentAuthor,parentKey,postedAt)=>({id:`c${i}`,kind:'authored_reply',author:username,text,postedAt,url:`https://www.threads.com/@${username}/post/${username.replace(/\W/g,'')}c${i}`,parentAuthor,parentUrl:`https://www.threads.com/@${parentAuthor}/post/${parentKey}`,isQuote:false,isRepost:false});
const scan=(username,name,posts,comments,extra={})=>({id:`demo-${username}`,status:'completed',account:{username,url:`https://www.threads.com/@${username}`,name},posts,comments,createdAt:at(1,0,0),completedAt:at(1,0,0),...extra});
const ORDINARY_POSTS=['今天把陽台的九層塔重新換盆，希望這次不要再被蟲吃光。','週末去了一趟基隆，廟口的營養三明治還是那個味道。','終於把拖了三個月的報稅資料整理完，腦袋空空。','新買的耳機戴久了耳朵會痛，有人有同款的心得嗎？','颱風假在家追完一整季，隔天上班整個人都是恍的。','想問大家，租屋處的熱水器一直點不著，是該叫房東還是自己修？','老家的狗今年十四歲了，走路慢了但還是會來門口等人。','最近在練習早起，第三天就破功，果然不能太相信自己。'];
const CHAT=['這集真的把前面埋的線全收回來了，編劇很用心。','我也覺得後半段節奏有點趕，但結尾還是很感動。','這個角度沒想過，謝謝分享，回去再看一次。','你拍的那張夕陽比我現場看到的還好看。','所以你最後是選哪一家的方案？我也在猶豫。','這篇寫得很清楚，請問資料來源可以再多講一點嗎？','我家附近也有一間類似的，下次路過拍給你看。','原來如此，難怪我上次做出來會失敗。'];
const ARGUMENT=['你引用的那份報告是 2019 年的，後來的版本結論已經不一樣了。','我沒有說全部都錯，我是說第二段的數字對不上原始資料。','請看一下原文第三頁的表格，分母不是你說的那個。','這不是立場問題，是你把兩個不同年度的資料混在一起。','我剛把連結貼在上面，你可以自己對一下。','好，如果是你說的那個定義，那我同意前半段。','但後半段的推論還是跳太快了，中間少了一個步驟。','我不是要吵，只是覺得這樣講會誤導沒看原文的人。','這個例子跟你要證明的事情其實是兩回事。','你最新那則回覆的連結打不開，是不是貼錯了？','謝謝你補的資料，這份我之前沒看過。','看完了，我還是認為樣本數太小，不能下那麼強的結論。','我們對結論的看法不同沒關係，至少資料來源對齊了。','補一句，那個圖表的 y 軸沒有從零開始，看起來差距被放大。','今天先到這裡，有新的資料再討論。'];
const SUPPORT_LONG=['您好，這個問題需要核對訂單資料，麻煩私訊提供訂單編號，我們會盡快處理。','抱歉造成不便，退款已於今日送出，依銀行作業約三到五個工作天入帳。','感謝回報，這個狀況我們已轉給技術同仁確認，有進度會再回覆您。'];
const SUPPORT_SHORT=['收到','已處理','私訊您','已回覆','請稍候','好的','已轉交','感謝','已修正','了解','已送出','已更新'];

export function fanOfPopularCreator(){
 // 50 replies: 30 to @demo.creator across 12 of their posts, 20 to eight other authors. Minutes apart, varied text.
 const username='demo.fan',posts=ORDINARY_POSTS.map((t,i)=>post(username,i,t,at(1,2+i,10)));
 const comments=[];let n=0;
 for(let i=0;i<30;i++)comments.push(reply(username,n++,`${CHAT[i%CHAT.length]}（${i+1}）`,'demo.creator',`creator${i%12}`,at(2+Math.floor(i/6),9+(i%6)*2,(i*7)%60)));
 for(let i=0;i<20;i++)comments.push(reply(username,n++,`${CHAT[(i+3)%CHAT.length]}［${i+1}］`,`demo.author${i%8}`,`other${i}`,at(8+Math.floor(i/5),8+(i%5)*3,(i*11)%60)));
 // The creator's own saved scan: their replies go to someone else, so the focus is one-sided.
 return scan(username,'忠實粉絲（合成）',posts,comments,{mutual:{partner:'demo.creator',scanned:true,partnerScanId:'demo-demo.creator',partnerTopAuthor:'demo.someone',partnerShare:.4}});
}
export function arguerUnderViralPost(){
 // 15 replies under one viral post, each 1 to 5 minutes after the previous one.
 const username='demo.arguer',posts=ORDINARY_POSTS.map((t,i)=>post(username,i,t,at(3,1+i,5)));
 let minute=0;const comments=ARGUMENT.map((t,i)=>{minute+=1+(i*3)%5;return reply(username,i,t,'demo.viral','viral1',at(5,12,minute,(i*17)%60))});
 return scan(username,'在爆文下吵架的普通人（合成）',posts,comments,{mutual:{partner:'demo.viral',scanned:true,partnerScanId:'demo-demo.viral',partnerTopAuthor:'demo.someone',partnerShare:.3}});
}
export function customerServiceAccount(){
 // 30 replies to 30 different customers: 27 short acknowledgements, 3 longer answers. Hours apart.
 const username='demo.support',posts=['本週五系統維護公告：晚間十一點到凌晨一點暫停服務，造成不便敬請見諒。','新版 App 已上架，更新後請重新登入一次。','客服時間調整：平日九點到十八點，假日休息。','十月帳單將於五日寄出，請留意信箱。','門市取貨服務新增三個據點，詳見官網。','退換貨流程更新，收到商品七日內都可申請。','感謝大家的回饋，搜尋功能的問題已修復。','活動期間客服量較大，回覆時間可能延長，請見諒。'].map((t,i)=>post(username,i,t,at(1,3+i,0)));
 const comments=Array.from({length:30},(_,i)=>reply(username,i,i%10===9?SUPPORT_LONG[Math.floor(i/10)]:`${SUPPORT_SHORT[i%SUPPORT_SHORT.length]}${i%3===0?'！':'。'}`,`demo.customer${i}`,`ask${i}`,at(6+Math.floor(i/6),9+(i%6),(i*13)%60)));
 return scan(username,'客服帳號（合成）',posts,comments);
}
export function ordinaryAccount(){
 // Nothing trips: distinct posts, 12 replies to 12 authors, no two within a minute.
 const username='demo.plain',posts=ORDINARY_POSTS.map((t,i)=>post(username,i,t,at(2,1+i,20)));
 const comments=Array.from({length:12},(_,i)=>reply(username,i,`${CHAT[i%CHAT.length]}〔${i+1}〕`,`demo.friend${i}`,`talk${i}`,at(9+Math.floor(i/4),10+(i%4)*2,(i*19)%60)));
 return scan(username,'一般帳號（合成）',posts,comments);
}
// expected: pinned score, per-rule status in rule order, and groupsHit. Thresholds that start flagging these
// controls must change these expectations knowingly, in the same commit.
export const negativeControls=()=>[
 {id:'fan',label:'熱門創作者的忠實粉絲',scan:fanOfPopularCreator(),expected:{value:1,statuses:['no','no','yes','no','no','no'],groupsHit:{count:1,total:3,content:false,relation:true,time:false}}},
 {id:'arguer',label:'在爆文下跟人吵架的普通人',scan:arguerUnderViralPost(),expected:{value:1,statuses:['no','no','no','yes','no','no'],groupsHit:{count:1,total:3,content:false,relation:true,time:false}}},
 {id:'support',label:'客服帳號',scan:customerServiceAccount(),expected:{value:1,statuses:['no','yes','no','no','no','no'],groupsHit:{count:1,total:3,content:true,relation:false,time:false}}},
 {id:'ordinary',label:'一般帳號',scan:ordinaryAccount(),expected:{value:0,statuses:['no','no','no','no','no','no'],groupsHit:{count:0,total:3,content:false,relation:false,time:false}}}
];
