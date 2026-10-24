// Draws the extension's icons (16, 48, 128 px) from one SVG: a speech bubble in the extension's one accent colour with
// the chip's dot and a short bar inside — the "● 6 項中 4 項符合" chip, as a mark. No wordmark, one colour, so it
// reads at 16 px in the toolbar. Rendered by Playwright's Chromium with a transparent background.
//   node scripts/extension-icons.mjs            → extension/icons/icon-{16,48,128}.png
import fs from 'node:fs';
import path from 'node:path';
import {pngInfo} from './lib/png.mjs';
const {chromium}=await import('playwright');
const OUT=path.resolve(import.meta.dirname,'../extension/icons');
export const ICON_SVG=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
 <path fill="#d9480f" d="M30 14h68a22 22 0 0 1 22 22v44a22 22 0 0 1-22 22H58L28 118a4 4 0 0 1-6-3.5V101A22 22 0 0 1 8 80V36a22 22 0 0 1 22-22z"/>
 <circle cx="40" cy="58" r="11" fill="#fff"/>
 <rect x="60" y="48" width="46" height="20" rx="10" fill="#fff"/>
</svg>`;
const SIZES=[16,48,128];
fs.mkdirSync(OUT,{recursive:true});
const browser=await chromium.launch({channel:'chromium'});
for(const size of SIZES){
 const page=await browser.newPage({viewport:{width:size,height:size},deviceScaleFactor:1});
 await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${ICON_SVG.replace('<svg ',`<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`);
 const file=path.join(OUT,`icon-${size}.png`);
 await page.screenshot({path:file,omitBackground:true,clip:{x:0,y:0,width:size,height:size}});
 const info=pngInfo(fs.readFileSync(file));
 if(info.width!==size||info.height!==size)throw new Error(`${file}: ${info.width}×${info.height}`);
 console.log(`${path.relative(process.cwd(),file)} ${info.width}×${info.height}`);
 await page.close();
}
await browser.close();
