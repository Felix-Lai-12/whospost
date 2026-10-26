// The five Chrome Web Store screenshots (1280×800, 24-bit PNG, no alpha) in extension/store/screenshots/, from the
// e2e runner on the real logged-out Threads post page: --fake-api stands in for the Worker (the list is seeded with
// made-up entries, 即時查 answers from the runner's own fake API, nothing reaches the site), --mask gives every account
// on the page a stand-in name and a grey avatar, so no real account is shown beside a made-up signal in public.
//   node scripts/store-screenshots.mjs [--post <threads post url>] [--from <e2e-out dir>]
// --from reuses a finished run's folder instead of running the page again (the page can take a minute or two).
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pngInfo,toRgb24} from './lib/png.mjs';
const ROOT=path.resolve(import.meta.dirname,'..'),OUT=path.join(ROOT,'extension/store/screenshots');
const args=process.argv.slice(2),flag=n=>{const i=args.indexOf(n);return i>=0&&args[i+1]&&!args[i+1].startsWith('--')?args[i+1]:null;};
let from=flag('--from');
if(!from){
 from=fs.mkdtempSync(path.join(os.tmpdir(),'whospost-store-'));
 const run=['tests/extension/e2e/run.mjs','--live',...(flag('--post')?[flag('--post')]:[]),'--out',from,'--viewport','1280x800','--fake-api','--mask'];
 console.log('running',run.join(' '));
 const r=spawnSync(process.execPath,run,{cwd:ROOT,stdio:'inherit'});
 if(r.status!==0)console.warn(`e2e exited ${r.status}: live checks are warnings; going on with whatever was captured`);
}
const pick=(...names)=>{for(const n of names){const f=path.join(from,n);if(fs.existsSync(f))return f;}throw new Error(`none of ${names.join(', ')} in ${from}`);};
// 03: the 快篩 chip if the run caught it (it lives only between two polls), else the 查詢中 moment.
const SHOTS=[
 ['01-folded-row.png',pick('ui2-1-default-folded.png')],
 ['02-chip-popover.png',pick('ui2-2-popover.png')],
 ['03-live-check.png',pick('live-2-quick.png','live-1-scanning.png','live-3-done.png')],
 // The 0.1.0 set's 04 is the block button's cooldown, shot on a signed-in page (screenshots/README.md); a logged-out
 // run has no block step, so this falls back to the trust toast.
 ['04-block-helper.png',pick('f10-block-cooldown.png','ui2-3-trusted-toast.png')],
];
fs.mkdirSync(OUT,{recursive:true});
for(const [name,src] of SHOTS)write(name,fs.readFileSync(src));
// 05: the popup set over the page, where Chrome opens it (under the toolbar, at the right).
const {chromium}=await import('playwright');
const browser=await chromium.launch({channel:'chromium'});
const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});
const uri=f=>`data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
const popupInfo=pngInfo(fs.readFileSync(pick('popup-clip.png')));
await page.setContent(`<!doctype html><html><body style="margin:0;width:1280px;height:800px;overflow:hidden;position:relative;background:#fff">
<img src="${uri(pick('ui2-1-default-folded.png'))}" style="position:absolute;inset:0;width:1280px;height:800px">
<div style="position:absolute;inset:0;background:rgba(0,0,0,.18)"></div>
<div style="position:absolute;top:14px;right:22px;width:${popupInfo.width}px;height:${Math.min(popupInfo.height,772)}px;overflow:hidden;border-radius:10px;background:#fff;box-shadow:0 10px 36px rgba(0,0,0,.35),0 0 0 1px rgba(0,0,0,.08)"><img src="${uri(pick('popup-clip.png'))}" style="display:block;width:${popupInfo.width}px"></div>
</body></html>`);
await page.waitForTimeout(200);
write('05-popup.png',await page.screenshot({clip:{x:0,y:0,width:1280,height:800}}));
await browser.close();
function write(name,buf){
 const rgb=toRgb24(buf),info=pngInfo(rgb);
 if(info.width!==1280||info.height!==800||info.colorType!==2)throw new Error(`${name}: ${info.width}×${info.height} colour type ${info.colorType}`);
 fs.writeFileSync(path.join(OUT,name),rgb);
 console.log(`${path.relative(ROOT,path.join(OUT,name))}  ${info.width}×${info.height}  ${(rgb.length/1024).toFixed(0)} KB`);
}
