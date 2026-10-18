// Exports saved results for the given accounts from a local SQLite database into a seed JSON for
// POST /api/admin/import. Spend ledgers are never exported; other accounts' evidence rows are left out.
import {DatabaseSync} from 'node:sqlite';
import {writeFileSync} from 'node:fs';
const [db,out,...usernames]=process.argv.slice(2);
if(!db||!out||!usernames.length)throw new Error('Usage: node scripts/export-seed.mjs DATABASE OUT.json USERNAME...');
const scansDb=new DatabaseSync(db,{readOnly:true});
const scans=[];
for(const username of usernames.map(u=>u.toLowerCase())){
 // Same choice as Store.findSaved: the newest completed scan that has data, else the newest completed one.
 const rows=scansDb.prepare("SELECT * FROM scans WHERE username=? AND status='completed' ORDER BY created_at DESC").all(username);
 const row=rows.find(r=>{const j=JSON.parse(r.result_json);return j.posts?.length||j.comments?.length;})??rows[0];
 if(row)scans.push(row);else console.warn(`no completed scan for ${username}`);
}
const ids=scans.map(s=>s.id),allowed=new Set(usernames.map(u=>u.toLowerCase()));
const own=r=>allowed.has(String(r.author).replace(/^@/,'').toLowerCase());
const pick=(sql)=>ids.flatMap(id=>scansDb.prepare(sql).all(id));
const seed={scans,
 observations:pick('SELECT scan_id,author,content_id,observed_at,source,evidence_json FROM observations WHERE scan_id=?').filter(own),
 evidence:pick('SELECT * FROM evidence WHERE scan_id=?').filter(own),
 analysis_runs:pick('SELECT * FROM analysis_runs WHERE scan_id=? ORDER BY analyzed_at DESC LIMIT 1'),
 ai_jobs:[]};
const aiPath=process.env.WHOSPOST_AI_LEDGER;
if(aiPath){const ai=new DatabaseSync(aiPath,{readOnly:true});seed.ai_jobs=ai.prepare("SELECT * FROM ai_jobs WHERE status='ready'").all().filter(j=>allowed.has(JSON.parse(j.plan).input.account.username));}
writeFileSync(out,JSON.stringify(seed));
console.log(JSON.stringify({scans:scans.map(s=>[s.username,s.id]),observations:seed.observations.length,evidence:seed.evidence.length,aiJobs:seed.ai_jobs.length}));
