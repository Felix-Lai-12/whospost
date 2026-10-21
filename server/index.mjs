import {resolve,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {createAiBackend} from './ai/bootstrap.mjs';
import {readSecret} from './env-file.mjs';
import {Store} from './store.mjs';import {createApp} from './http.mjs';
// Only this process receives the local credential. Never return or log its value.
if(!process.env.APIFY_TOKEN){const token=readSecret('APIFY_TOKEN');if(token)process.env.APIFY_TOKEN=token;}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const store=new Store(process.env.WHOSPOST_DB??resolve(root,'data/whospost.sqlite'),{budgetLimitUsd:process.env.WHOSPOST_APIFY_LIMIT_USD==='0'?null:Number(process.env.WHOSPOST_APIFY_LIMIT_USD??1)});
const fetchAccount=async(...args)=>(await import('./providers/index.mjs')).fetchAccount(...args);
const precheck=async(...args)=>(await import('./providers/threads-profile.mjs')).checkThreadsProfile(...args);
const settleBills=async(...args)=>(await import('./providers/index.mjs')).waitAndSettleBills(...args);
let aiBackend;try{aiBackend=createAiBackend(root);}catch{console.warn('AI backend unavailable; account scans remain available.');}
const app=createApp({store,fetchAccount,precheck,settleBills,distDir:resolve(root,'dist'),profileId:process.env.WHOSPOST_COLLECTION_PROFILE??'standard',crossAccountSearch:process.env.WHOSPOST_CROSS_ACCOUNT_SEARCH==='1',aiService:aiBackend?.service});
const port=Number(process.env.PORT??8788);app.server.listen(port,'127.0.0.1',()=>{console.log(`Whospost http://127.0.0.1:${port}`);app.resume();});
process.on('SIGTERM',()=>app.server.close(()=>{aiBackend?.close();store.close();process.exit(0);}));
