// Draws the extension's icons (16, 48, 128 px): the site's brand mark, 「w.」 on the highlight yellow in an ink frame,
// tilted with a hard shadow (frontend/src/style.css .brand-icon), so the toolbar, the store and the site look like
// one product. At 16 px the tilt and shadow would blur into the frame, so that size is upright and flat.
// Rendered by Playwright's Chromium with a transparent background.
//   node scripts/extension-icons.mjs            → extension/icons/icon-{16,48,128}.png
import fs from 'node:fs';
import path from 'node:path';
import {pngInfo} from './lib/png.mjs';
const {chromium}=await import('playwright');
const OUT=path.resolve(import.meta.dirname,'../extension/icons');
const INK='#303e49',HIGHLIGHT='#f6e7a6',FONT=`'Noto Sans TC','PingFang TC',-apple-system,BlinkMacSystemFont,sans-serif`;
// box: the yellow square (px); border, radius, shadow offset, tilt (deg), font size, letter spacing, nudge right and lift up (px)
const SIZES={
 16:{box:16,border:1.25,radius:4,shadow:0,tilt:0,font:12.5,spacing:-1,nudge:0,lift:0},
 48:{box:38,border:3,radius:11,shadow:3,tilt:-5,font:21,spacing:-1.4,nudge:-1,lift:1},
 128:{box:96,border:6,radius:28,shadow:7,tilt:-5,font:54,spacing:-3.6,nudge:-2,lift:2},
};
export const iconHtml=(size,{box,border,radius,shadow,tilt,font,spacing,nudge,lift})=>`<!doctype html><html><body style="margin:0;background:transparent;width:${size}px;height:${size}px;display:grid;place-items:center">
<div style="box-sizing:border-box;width:${box}px;height:${box}px;margin:0 ${shadow}px ${shadow}px 0;background:${HIGHLIGHT};border:${border}px solid ${INK};border-radius:${radius}px;box-shadow:${shadow}px ${shadow}px 0 ${INK};transform:rotate(${tilt}deg);display:grid;place-items:center;font:800 ${font}px/1 ${FONT};letter-spacing:${spacing}px;color:${INK}"><span style="position:relative;left:${nudge}px;top:-${lift}px">w.</span></div></body></html>`;
fs.mkdirSync(OUT,{recursive:true});
const browser=await chromium.launch({channel:'chromium'});
for(const [s,spec] of Object.entries(SIZES)){
 const size=Number(s);
 const page=await browser.newPage({viewport:{width:size,height:size},deviceScaleFactor:1});
 await page.setContent(iconHtml(size,spec));
 const file=path.join(OUT,`icon-${size}.png`);
 await page.screenshot({path:file,omitBackground:true,clip:{x:0,y:0,width:size,height:size}});
 const info=pngInfo(fs.readFileSync(file));
 if(info.width!==size||info.height!==size)throw new Error(`${file}: ${info.width}×${info.height}`);
 console.log(`${path.relative(process.cwd(),file)} ${info.width}×${info.height}`);
 await page.close();
}
await browser.close();
