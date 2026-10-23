import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {accountFromInputLoose} from '../../extension/lib/popup-input.mjs';
const ROOT=path.resolve(import.meta.dirname,'../../extension');
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'manifest.json'),'utf8'));

test('MV3 with storage as the only permission, hosts limited to Threads and the site, Chrome 116+ (§6.1)',()=>{
 assert.equal(manifest.manifest_version,3);
 assert.deepEqual(manifest.permissions,['storage']);
 assert.deepEqual(manifest.host_permissions,['https://www.threads.com/*','https://www.threads.net/*','https://whospost.felixlai.workers.dev/*']);
 assert.equal(manifest.minimum_chrome_version,'116');
 for(const forbidden of ['tabs','scripting','webRequest','activeTab','history','cookies'])assert.equal((manifest.permissions??[]).includes(forbidden)||(manifest.optional_permissions??[]).includes(forbidden),false,forbidden);
 assert.equal(manifest.background.type,'module');
 assert.equal(manifest.content_scripts.length,1);
 assert.deepEqual(manifest.content_scripts[0].matches,['https://www.threads.com/*','https://www.threads.net/*'],'both Threads domains, nothing else');
 assert.equal(manifest.content_scripts[0].run_at,'document_idle');
 assert.deepEqual(manifest.web_accessible_resources[0].matches,manifest.content_scripts[0].matches,'the module files are exposed to Threads pages only');
 assert.match(manifest.name,/Whospost/);assert.match(manifest.description,/不判定身分/);
});

test('every file the manifest names exists; lib/signals.mjs is the shared module itself, not a copy',()=>{
 const files=[manifest.background.service_worker,...manifest.content_scripts[0].js,...manifest.content_scripts[0].css,manifest.action.default_popup];
 for(const f of files)assert.ok(fs.existsSync(path.join(ROOT,f)),f);
 for(const f of ['lib/engine.mjs','lib/parse.mjs','lib/thread.mjs','lib/list.mjs','lib/state.mjs','lib/settings.mjs','lib/label.mjs','lib/hash.mjs','popup.js','popup.css'])assert.ok(fs.existsSync(path.join(ROOT,f)),f);
 const link=path.join(ROOT,'lib/signals.mjs');
 assert.ok(fs.lstatSync(link).isSymbolicLink(),'a symlink so the rules live in one place');
 assert.equal(fs.realpathSync(link),fs.realpathSync(path.join(ROOT,'../shared/signals.mjs')));
});

test('the extension never sends anything to Threads and only opens the site: no fetch to threads hosts anywhere in the code',()=>{
 const code=['background.js','content.js','popup.js','lib/engine.mjs','lib/label.mjs'].map(f=>fs.readFileSync(path.join(ROOT,f),'utf8')).join('\n');
 assert.equal(/fetch\([^)]*threads\./.test(code),false);
 assert.equal(/document\.cookie/.test(code),false);
 assert.equal(/credentials:'omit'/.test(fs.readFileSync(path.join(ROOT,'background.js'),'utf8')),true,'list and appeal requests carry no cookies');
 for(const f of ['popup.html','lib/label.mjs']){const t=fs.readFileSync(path.join(ROOT,f),'utf8');assert.equal(/網軍的機率|可能是網軍|判定為網軍|%/.test(t),false,`${f} never gives a troll probability or verdict`);}
});

test('the popup\'s account box accepts @name, name or a profile link, like the site',()=>{
 assert.equal(accountFromInputLoose('@Zuck'),'zuck');assert.equal(accountFromInputLoose(' zuck '),'zuck');
 assert.equal(accountFromInputLoose('https://www.threads.com/@zuck/'),'zuck');assert.equal(accountFromInputLoose('https://www.threads.com/@zuck/post/abc'),'zuck');
 assert.equal(accountFromInputLoose(''),null);assert.equal(accountFromInputLoose('not a name!'),null);assert.equal(accountFromInputLoose('a'.repeat(31)),null);
});
