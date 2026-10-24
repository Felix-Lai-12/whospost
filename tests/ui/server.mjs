// Local UI fixtures only: no external network, no credentials, no persistent data.
import {Store} from '../../server/store.mjs';
import {createApp} from '../../server/http.mjs';
import {resolve} from 'node:path';
if(process.env.WHOSPOST_UI_FIXTURE!=='1')throw Error('Explicit fixture mode required');
const username='fixture_demo';
const text='【模擬測試資料，非真實帳號】這是一段足夠長的測試文字，僅用於驗證介面顯示與資料比對功能。';
const posts=Array.from({length:5},(_,i)=>({id:`p${i}`,author:username,kind:'post',text:text+['網站功能說明','社群討論觀察','調查時間紀錄','新聞閱讀筆記','資料來源比較'][i],postedAt:'2026-10-17T01:00:00Z',url:`https://www.threads.com/@fixture_demo/post/test${i}`,parentUrl:null,isQuote:false,isRepost:false,source:'UI fixture'}));
const comments=[0,1].map(i=>({...posts[i],id:`c${i}`,kind:'authored_reply',text:text+'視頻',parentAuthor:`fixture_parent${i}`,parentUrl:`https://www.threads.com/@fixture_parent${i}/post/test${i}`}));
const comparison=[0,1].map(i=>({...posts[0],id:`o${i}`,author:`fixture_other${i}`,kind:'comparison'}));
// WHOSPOST_UI_FIXTURE_STAGE_MS: wait this long before posts, before replies and before the result, to show the staged view.
// WHOSPOST_UI_FIXTURE_FOLLOWERS: the follower count the fixture account reports; unset shows the not-obtained state.
const followers=process.env.WHOSPOST_UI_FIXTURE_FOLLOWERS?Number(process.env.WHOSPOST_UI_FIXTURE_FOLLOWERS):null;
const stageMs=Number(process.env.WHOSPOST_UI_FIXTURE_STAGE_MS??0),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const store=new Store(':memory:');
const app=createApp({store,configured:()=>true,distDir:resolve('dist'),fetchAccount:async(target,{onPartial=()=>{}}={})=>{if(target!==username)throw Error('Only fixture_demo is available in this test server');if(stageMs){await sleep(stageMs);onPartial({account:{name:'UI 模擬資料・非真實帳號'},posts});await sleep(stageMs);onPartial({comments});await sleep(stageMs);}return {account:{username,url:`https://www.threads.com/@${username}`,name:'UI 模擬資料・非真實帳號',followers},posts,comments,comparison,comparedTargetIds:posts.map(p=>p.id),commentsAvailable:true,limitations:['本頁為 UI 測試資料，不是真實帳號的查詢結果。'],vocabularyEntries:[{term:'視頻',sourceUrl:'https://invade.tw/vocabs'}],factChecks:{status:'no_match',items:[],queryText:text,sourcePostId:'p0',license:'CC BY-SA 4.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/'}};}});
app.server.listen(8790,'127.0.0.1',()=>console.log('UI fixture only: http://127.0.0.1:8790'));
