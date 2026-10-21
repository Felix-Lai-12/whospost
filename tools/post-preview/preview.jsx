import React from 'react';import {createRoot} from 'react-dom/client';
import '../../frontend/src/style.css';import PostComposition from '../../frontend/src/PostComposition.jsx';
const input={post:{code:'synthetic-post',author:'synthetic_owner'},comments:Array.from({length:25},(_,i)=>({id:`p${i}`,author:`synthetic_${i}`,text:`這是第 ${i} 位留言者的合成意見，與真實帳號無關。`,postedAt:'2026-10-21T00:00:00Z',authorMeta:{hasAvatar:i>8,verified:false}}))};
const baselineInput={...input,post:{code:'synthetic-baseline',author:'synthetic_baseline_owner'}};
const profiles=Object.fromEntries(input.comments.map((c,i)=>[c.author,{followers:i<10?5:100,bio:'',hasAvatar:i>8}]));
const baselineProfiles=Object.fromEntries(input.comments.map((c,i)=>[c.author,{followers:100,bio:'baseline',hasAvatar:true}]));
const corpus=[{post:{code:'synthetic-other-1',author:'synthetic_peer1'},accounts:[{author:'synthetic_0'},{author:'synthetic_1'}]},{post:{code:'synthetic-other-2',author:'synthetic_peer2'},accounts:[{author:'synthetic_0'},{author:'synthetic_1'}]}];
createRoot(document.getElementById('root')).render(<><p style={{padding:16}}>合成資料預覽 · 尚未接正式入口</p><PostComposition {...{input,baselineInput,profiles,baselineProfiles,corpus}}/></>);
