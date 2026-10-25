// The Chrome Web Store pack (EXTENSION-SPEC §9 P3): listing text that matches the manifest, icons and screenshots
// in the sizes and formats the store takes, the privacy form answers that name every permission, and a package
// built by scripts/pack-extension.mjs that holds only what the browser loads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pngInfo} from '../../scripts/lib/png.mjs';
import {zipList} from '../../scripts/lib/zip.mjs';
import {packExtension} from '../../scripts/pack-extension.mjs';
const EXT=path.resolve(import.meta.dirname,'../../extension'),STORE=path.join(EXT,'store');
const manifest=JSON.parse(fs.readFileSync(path.join(EXT,'manifest.json'),'utf8'));
const read=f=>fs.readFileSync(path.join(STORE,f),'utf8');
/** The text under a "## heading" in a listing file, up to the next heading. */
const section=(text,heading)=>{const m=text.match(new RegExp(`^## ${heading}[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`,'m'));return m?m[1].trim():null;};

test('listing (zh-TW): the name and summary are the manifest\'s, the summary fits 132 characters, the support URL is the site',()=>{
 const t=read('listing.zh-TW.md');
 assert.equal(section(t,'名稱'),manifest.name);
 assert.equal(section(t,'一句話簡介'),manifest.description);
 assert.ok([...manifest.description].length<=132);
 assert.match(t,/支援網址：https:\/\/whospost\.felixlai\.workers\.dev\//);
 assert.match(t,/隱私權政策：https:\/\/whospost\.felixlai\.workers\.dev\/privacy/);
 assert.match(section(t,'分類'),/Social & Communication/);
});

test('listing (en): a summary within 132 characters, the same URLs',()=>{
 const t=read('listing.en.md');
 const summary=section(t,'Summary');
 assert.ok(summary&&[...summary].length<=132,`summary is ${[...summary??''].length} characters`);
 assert.match(t,/Support: https:\/\/whospost\.felixlai\.workers\.dev\//);
});

test('both listings describe without judging: no troll verdict or probability wording, every signal named',()=>{
 for(const f of ['listing.zh-TW.md','listing.en.md']){
  const t=read(f);
  assert.equal(/網軍的機率|可能是網軍|判定為網軍|就是網軍|troll probability|bot probability|likely a troll|is a bot/.test(t),false,`${f} never calls anyone a troll`);
  assert.match(t,/不判定任何人是網軍|never says anyone is a troll/);
 }
 const zh=read('listing.zh-TW.md');
 for(const name of ['貼文內容重複','留言大量重複','半數以上給同一作者','同篇超過 10 次','互相集中回覆','10 秒內連留 3 次'])assert.ok(zh.includes(name),name);
});

test('privacy form: single purpose, a reason for storage and for each host, remote code = no, the data table',()=>{
 const t=read('privacy-form.md');
 assert.match(t,/## 1\. 單一用途/);
 assert.match(t,/### `storage`/);
 for(const h of manifest.host_permissions)assert.ok(t.includes(h),h);
 assert.match(t,/Are you using remote code\? → No/);
 assert.match(t,/\| User activity[^|]*\| \*\*是\*\*/);
 assert.match(t,/\| Website content[^|]*\| \*\*是\*\*/);
 assert.match(t,/https:\/\/whospost\.felixlai\.workers\.dev\/privacy/);
 // The form lists exactly the permissions the manifest has: a new permission must come here too.
 assert.deepEqual(manifest.permissions,['storage']);
});

test('icons: 16, 48 and 128 px PNGs, the 128 one is the store icon',()=>{
 for(const [size,file] of Object.entries(manifest.icons)){
  const info=pngInfo(fs.readFileSync(path.join(EXT,file)));
  assert.equal(info.width,Number(size),file);assert.equal(info.height,Number(size),file);
 }
});

test('screenshots: five 1280×800 24-bit PNGs without alpha, in the order the listing shows them',()=>{
 const dir=path.join(STORE,'screenshots');
 const files=fs.readdirSync(dir).filter(f=>f.endsWith('.png')).sort();
 assert.deepEqual(files,['01-folded-row.png','02-chip-popover.png','03-live-check.png','04-trust-undo.png','05-popup.png']);
 for(const f of files){
  const info=pngInfo(fs.readFileSync(path.join(dir,f)));
  assert.deepEqual({w:info.width,h:info.height,c:info.colorType,d:info.bitDepth},{w:1280,h:800,c:2,d:8},f);
 }
});

test('pack: dist/whospost-extension-<version>.zip holds the files the browser loads and nothing from docs, store or tests; signals.mjs is a file',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'whospost-pack-'));
 const r=packExtension({out:path.join(dir,'x.zip')});
 assert.equal(r.version,manifest.version);
 const names=r.entries.map(e=>e.name);
 for(const f of ['manifest.json','background.js','content.js','content.css','popup.html','popup.js','popup.css','lib/engine.mjs','lib/signals.mjs',...Object.values(manifest.icons)])assert.ok(names.includes(f),f);
 assert.equal(names.some(n=>/^(docs|store)\//.test(n)||/README|\.test\.|e2e|\.DS_Store/.test(n)),false,names.join(' '));
 assert.equal(names.some(n=>n.startsWith('.')||n.includes('/.')),false,'no dotfiles');
 const signals=r.entries.find(e=>e.name==='lib/signals.mjs');
 assert.equal(signals.size,fs.statSync(path.resolve(EXT,'../shared/signals.mjs')).size,'the shared module itself, not a symlink');
 // The archive reads back with the same names (central directory), and the default output path carries the version.
 assert.deepEqual(zipList(fs.readFileSync(r.file)).map(e=>e.name),names);
 const dflt=packExtension({out:path.join(dir,`whospost-extension-${manifest.version}.zip`)});
 assert.ok(dflt.file.endsWith(`whospost-extension-${manifest.version}.zip`));
 fs.rmSync(dir,{recursive:true,force:true});
});

test('pack: a version without 封鎖助手 (0.1.0, the store submission) leaves out the profile-tab runner; 0.2.0 has it',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'whospost-pack-block-'));
 const copy=version=>{
  const d=path.join(dir,version);fs.cpSync(EXT,d,{recursive:true,dereference:true,filter:s=>!/[\\/](docs|store)$/.test(s)});
  fs.writeFileSync(path.join(d,'manifest.json'),JSON.stringify({...manifest,version}));return d;
 };
 const old=packExtension({extDir:copy('0.1.0'),out:path.join(dir,'old.zip')});
 assert.equal(old.block,false);
 const oldNames=old.entries.map(e=>e.name);
 assert.equal(oldNames.includes('lib/block-page.mjs'),false,'0.1.0 holds no code that presses Threads buttons');
 for(const f of ['lib/block.mjs','lib/flags.mjs','lib/engine.mjs','content.js','popup.js'])assert.ok(oldNames.includes(f),`${f}: still imported, so it stays`);
 const next=packExtension({extDir:copy('0.2.0'),out:path.join(dir,'next.zip')});
 assert.equal(next.block,true);
 assert.ok(next.entries.some(e=>e.name==='lib/block-page.mjs'));
 fs.rmSync(dir,{recursive:true,force:true});
});
