import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,SCHEMA_VERSION,mergeSettings,inElectionWindow,effectiveMode,electionActive,taipeiDate} from "../../extension/lib/settings.mjs";
import * as settingsModule from "../../extension/lib/settings.mjs";

test('nothing saved gives the decided defaults: fold by default, suspicious and folded from 3 of 6, thread 5/10/3, election auto, icon on, reporting on',()=>{
 const s=mergeSettings(null);
 assert.deepEqual(s,{schemaVersion:SCHEMA_VERSION,enabled:true,mode:'collapse',fadeAt:3,collapseAt:3,thread:{enabled:true,barAt:5,fadeAt:10,sameContentAt:3},election:'auto',showIcon:true,report:true,apiBase:''});
 assert.deepEqual(mergeSettings(undefined),s);assert.deepEqual(mergeSettings('junk'),s);
 assert.deepEqual(s,{...DEFAULTS,thread:{...DEFAULTS.thread}});
});

test('a partial or malformed save is merged field by field, never replaces the whole object',()=>{
 const s=mergeSettings({mode:'fade',thread:{barAt:7}});
 assert.equal(s.mode,'fade');assert.equal(s.thread.barAt,7);assert.equal(s.thread.fadeAt,10);assert.equal(s.fadeAt,3);
 const bad=mergeSettings({enabled:'yes',mode:'hide',fadeAt:'3',collapseAt:99,election:'maybe',showIcon:0,thread:{enabled:1,barAt:1,fadeAt:-5,sameContentAt:1.5}});
 assert.deepEqual(bad,mergeSettings(null),'every malformed field falls back');
});

test('thresholds keep their order: collapse never below fade, thread fade never below thread bar; schemaVersion is rewritten',()=>{
 assert.equal(mergeSettings({fadeAt:5,collapseAt:2}).collapseAt,5);
 assert.equal(mergeSettings({thread:{barAt:12,fadeAt:3}}).thread.fadeAt,12);
 assert.equal(mergeSettings({schemaVersion:0}).schemaVersion,SCHEMA_VERSION);
 assert.equal(mergeSettings({schemaVersion:99,fadeAt:2}).fadeAt,2);
});

test('election window is 2026-11-18 to 2026-11-28 in Taipei time, inclusive',()=>{
 assert.equal(taipeiDate(Date.parse('2026-11-17T16:00:00Z')),'2026-11-18');
 assert.equal(inElectionWindow(Date.parse('2026-11-17T15:59:59Z')),false,'11-17 23:59:59 Taipei');
 assert.equal(inElectionWindow(Date.parse('2026-11-17T16:00:00Z')),true,'11-18 00:00 Taipei');
 assert.equal(inElectionWindow(Date.parse('2026-11-28T15:59:59Z')),true,'11-28 23:59:59 Taipei');
 assert.equal(inElectionWindow(Date.parse('2026-11-28T16:00:00Z')),false,'11-29 00:00 Taipei');
 assert.equal(inElectionWindow(Date.parse('2026-10-23T00:00:00Z')),false);
});

test('effective mode: auto follows the window, on forces label, off keeps the chosen mode',()=>{
 const inside=Date.parse('2026-11-20T04:00:00Z'),outside=Date.parse('2026-10-23T04:00:00Z');
 const auto=mergeSettings({mode:'collapse'});
 assert.equal(effectiveMode(auto,outside),'collapse');assert.equal(effectiveMode(auto,inside),'label');
 assert.equal(effectiveMode(mergeSettings({mode:'collapse',election:'on'}),outside),'label');
 assert.equal(effectiveMode(mergeSettings({mode:'collapse',election:'off'}),inside),'collapse');
 assert.equal(electionActive(auto,inside),true);assert.equal(electionActive(mergeSettings({election:'off'}),inside),false);
});

test('apiBase (development): empty is the site; https origins and local http pass; paths, other http hosts and junk fall back',()=>{
 const {validApiBase,apiBaseOf,DEFAULT_SITE}=settingsModule;
 assert.equal(DEFAULT_SITE,'https://whospost.felixlai.workers.dev');
 assert.equal(validApiBase(''),'');assert.equal(validApiBase(null),'');
 assert.equal(validApiBase('http://localhost:8787'),'http://localhost:8787');assert.equal(validApiBase('http://127.0.0.1:8787/'),'http://127.0.0.1:8787');
 assert.equal(validApiBase('https://staging.example'),'https://staging.example');
 for(const bad of ['http://evil.example','https://x.example/api','https://x.example/?a=1','ftp://x','not a url','https://user@x.example'])assert.equal(validApiBase(bad),null,bad);
 assert.equal(mergeSettings({apiBase:'http://evil.example'}).apiBase,'','a rejected value falls back to the site');
 assert.equal(mergeSettings({apiBase:'http://localhost:8787'}).apiBase,'http://localhost:8787');
 assert.equal(apiBaseOf(mergeSettings(null)),DEFAULT_SITE);assert.equal(apiBaseOf(mergeSettings({apiBase:'http://localhost:8787'})),'http://localhost:8787');
});
