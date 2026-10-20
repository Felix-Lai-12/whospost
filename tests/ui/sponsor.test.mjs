import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSponsorSlots,sponsorFor,sponsorClickTracking,sponsorImpression,SPONSOR_SLOTS} from '../../frontend/src/sponsor-model.mjs';

const src=f=>readFileSync(new URL(`../../frontend/src/${f}`,import.meta.url),'utf8');
const valid=[
 {slot:'result_bottom',campaign:'acme-2026q4',image:'/sponsor/acme.png',href:'https://example.com/acme',alt:'Acme 贊助本月查詢'},
 {slot:'waiting',campaign:'beta_1',image:'/sponsor/beta.webp',href:'https://example.org/?utm_source=whospost',alt:'Beta'}
];
const fake=()=>{const sent=[],once=new Set();return {sent,track:(n,p)=>sent.push([n,p]),trackOnce(k,n,p){if(once.has(k))return;once.add(k);sent.push([n,p])}};};

test('unset or empty VITE_SPONSOR_SLOTS renders no slot at all',()=>{
 for(const raw of [undefined,null,'','   ',0,{}])assert.deepEqual(parseSponsorSlots(raw),[],String(raw));
 assert.equal(sponsorFor([],'result_bottom'),null);
});

test('malformed or unsafe config is dropped instead of rendering',()=>{
 for(const raw of ['{','[{"slot":"result_bottom"}]','{"slot":"result_bottom"}','"result_bottom"','[1,null,"x"]'])assert.deepEqual(parseSponsorSlots(raw),[],raw);
 const bad=[
  {...valid[0],slot:'header'},{...valid[0],slot:'input'},
  {...valid[0],campaign:'Bad Campaign'},{...valid[0],campaign:'x'.repeat(33)},
  {...valid[0],image:'https://cdn.example.com/a.png'},{...valid[0],image:'//evil.example/a.png'},{...valid[0],image:'/sponsor/../secret.png'},{...valid[0],image:'sponsor/a.png'},
  {...valid[0],href:'http://example.com/'},{...valid[0],href:'javascript:alert(1)'},{...valid[0],href:'not a url'},
  {...valid[0],alt:''},{...valid[0],alt:'x'.repeat(121)},{...valid[0],alt:42}
 ];
 for(const entry of bad)assert.deepEqual(parseSponsorSlots(JSON.stringify([entry])),[],JSON.stringify(entry));
 // One bad entry never takes the good ones down with it, and the first entry per slot wins.
 const mixed=parseSponsorSlots(JSON.stringify([bad[0],valid[0],{...valid[0],campaign:'second'},valid[1]]));
 assert.deepEqual(mixed.map(s=>[s.slot,s.campaign]),[['result_bottom','acme-2026q4'],['waiting','beta_1']]);
});

test('a valid config yields both slots with normalized fields',()=>{
 const slots=parseSponsorSlots(JSON.stringify(valid));
 assert.deepEqual(SPONSOR_SLOTS,['result_bottom','waiting']);
 assert.deepEqual(slots,[
  {slot:'result_bottom',campaign:'acme-2026q4',image:'/sponsor/acme.png',href:'https://example.com/acme',alt:'Acme 贊助本月查詢'},
  {slot:'waiting',campaign:'beta_1',image:'/sponsor/beta.webp',href:'https://example.org/?utm_source=whospost',alt:'Beta'}
 ]);
 assert.equal(sponsorFor(slots,'waiting').campaign,'beta_1');
});

test('the slot component links with rel="noopener nofollow sponsored", labels itself 贊助 and loads nothing external',()=>{
 const jsx=src('Sponsor.jsx'),main=src('main.jsx');
 assert.match(jsx,/target="_blank" rel="noopener nofollow sponsored"/);
 assert.match(jsx,/贊助/);
 assert.match(jsx,/if\(!sponsor\)return null/,'unconfigured slot renders nothing, not a placeholder');
 assert.doesNotMatch(jsx,/createElement\('script'\)|<script|https?:\/\//,'no third-party script or hard-coded remote URL');
 assert.match(main,/<SponsorSlot slot="result_bottom"\/>/);
 assert.match(main,/\{busy&&<SponsorSlot slot="waiting"\/>\}/);
 // Never beside the search box or Turnstile: the intro section holds neither slot.
 const intro=main.slice(main.indexOf('<section className={`intro'),main.indexOf('</section>',main.indexOf('<section className={`intro')));
 assert.doesNotMatch(intro,/SponsorSlot/);
});

test('ad_click fires on click and middle-click with only slot and campaign; ad_impression once per slot',()=>{
 const a=fake(),[sponsor]=parseSponsorSlots(JSON.stringify(valid));
 const {onClick,onAuxClick}=sponsorClickTracking(a,sponsor);
 onClick({type:'click'});onAuxClick({type:'auxclick',button:1});onAuxClick({type:'auxclick',button:2});
 assert.deepEqual(a.sent,[['ad_click',{slot:'result_bottom',campaign:'acme-2026q4'}],['ad_click',{slot:'result_bottom',campaign:'acme-2026q4'}]]);
 sponsorImpression(a,sponsor);sponsorImpression(a,sponsor);sponsorImpression(a,{...sponsor,slot:'waiting'});
 assert.deepEqual(a.sent.slice(2),[['ad_impression',{slot:'result_bottom',campaign:'acme-2026q4'}],['ad_impression',{slot:'waiting',campaign:'acme-2026q4'}]]);
 for(const [,params] of a.sent)assert.deepEqual(Object.keys(params).sort(),['campaign','slot']);
});

test('README documents the variable and both events',()=>{
 const readme=readFileSync(new URL('../../README.md',import.meta.url),'utf8');
 assert.match(readme,/`VITE_SPONSOR_SLOTS`/);assert.match(readme,/fork 不設就沒有廣告/);
 assert.match(readme,/`ad_impression`/);assert.match(readme,/`ad_click`/);
});
