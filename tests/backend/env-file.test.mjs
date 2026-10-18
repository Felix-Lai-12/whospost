import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readSecret} from '../../server/env-file.mjs';
import {readAiConfig} from '../../server/ai/bootstrap.mjs';

test('secrets come from the environment first, then the configured env file',t=>{
 const dir=mkdtempSync(join(tmpdir(),'whos-env-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'.env.local');writeFileSync(file,'export APIFY_TOKEN="from-file"\nOTHER_KEY=other\n');
 assert.equal(readSecret('APIFY_TOKEN',{WHOSPOST_ENV_FILE:file}),'from-file');
 assert.equal(readSecret('APIFY_TOKEN',{WHOSPOST_ENV_FILE:file,APIFY_TOKEN:'from-env'}),'from-env');
 assert.equal(readSecret('GEMINI_API_KEY',{WHOSPOST_ENV_FILE:file}),null);
 assert.equal(readSecret('APIFY_TOKEN',{WHOSPOST_ENV_FILE:join(dir,'missing')}),null);
});

test('AI baseline ledger is optional, but a configured one must be readable',()=>{
 const root=new URL('../../',import.meta.url).pathname;
 assert.equal(readAiConfig(root,{}).baselineCommittedUsd,0);
 assert.equal(readAiConfig(root,{WHOSPOST_AI_BASELINE_LEDGER:'runtime/does-not-exist.json'}).baselineCommittedUsd,null);
});
