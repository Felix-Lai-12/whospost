import test from 'node:test';
import assert from 'node:assert/strict';
import {usernameFromHref,shortcodeFromHref,pageContext,parseContainer,textOf,healthVerdict,threadRootOf,HEALTH_MIN_PERMALINKS,CONTAINER_SELECTOR,AUTHOR_SELECTOR,PERMALINK_SELECTOR} from '../../extension/lib/parse.mjs';

// A minimal DOM for the handful of calls the parser makes (querySelectorAll, querySelector, closest, getAttribute,
// textContent, parentElement), with the selectors it uses. The fixture below mirrors a reply container as measured on
// threads.com on 2026-10-23 (logged out): two profile links first (avatar, name), the permalink wrapping <time>, the
// body in top-level span[dir="auto"] blocks, mentions as links inside the body, bare numbers for the counts.
const SEL=/^([a-z]*)(?:\[([a-z-]+)(?:([\^*$]?=)"([^"]*)")?\])?$/;
function matches(el,selector){
 const m=selector.trim().match(SEL);if(!m)throw new Error(`fake DOM cannot do ${selector}`);
 const [,tag,attr,op,val]=m;
 if(tag&&el.tag!==tag)return false;
 if(!attr)return true;
 const v=el.attrs[attr];if(v===undefined)return false;
 if(!op)return true;
 return op==='='?v===val:op==='^='?v.startsWith(val):op==='*='?v.includes(val):v.endsWith(val);
}
function node(tag,attrs={},children=[]){
 const el={tag,attrs,children:[],parentElement:null,
  get textContent(){return el.children.map(c=>typeof c==='string'?c:c.textContent).join('');},
  *walk(){for(const c of el.children)if(typeof c!=='string'){yield c;yield* c.walk();}},
  querySelectorAll(s){return [...el.walk()].filter(c=>matches(c,s));},
  querySelector(s){return el.querySelectorAll(s)[0]??null;},
  closest(s){let n=el;while(n){if(matches(n,s))return n;n=n.parentElement;}return null;},
  getAttribute(a){return el.attrs[a]??null;}
 };
 for(const c of children){if(typeof c!=='string')c.parentElement=el;el.children.push(c);}
 return el;
}
const span=(text,attrs={dir:'auto'})=>node('span',attrs,Array.isArray(text)?text:[text]);
const a=(href,children)=>node('a',{href},children);
function reply({user,code,body,op=false,mention=null}){
 return node('div',{'data-pressable-container':'true'},[node('div',{},[
  a(`/@${user}`,[node('img',{alt:`${user} 的大頭貼`})]),
  a(`/@${user}`,[span(user)]),
  span([a(`/@${user}/post/${code}`,[node('time',{datetime:'2026-10-23T00:00:00Z'},['7小時'])])]),
  ...(op?[span('·'),span('作者')]:[]),
  ...body.map(t=>span(mention&&t.includes(`@${mention}`)?[t.split(`@${mention}`)[0],a(`/@${mention}`,[`@${mention}`]),t.split(`@${mention}`)[1]]:t)),
  span('76'),span('5'),span(''),span('1.2萬')
 ])]);
}

test('profile links give a lowercase username; post links, other hosts and junk give null',()=>{
 assert.equal(usernameFromHref('/@Zuck'),'zuck');assert.equal(usernameFromHref('/@zuck/'),'zuck');
 assert.equal(usernameFromHref('https://www.threads.com/@Meta'),'meta');assert.equal(usernameFromHref('https://www.threads.net/@meta/'),'meta');
 assert.equal(usernameFromHref('/@meta/post/DezZbXvEpqd'),null,'a post link is not an author');
 assert.equal(usernameFromHref('/@meta/replies'),null);assert.equal(usernameFromHref('/search?q=@meta'),null);
 assert.equal(usernameFromHref('https://evil.example/@meta'),null);assert.equal(usernameFromHref(null),null);assert.equal(usernameFromHref('/@'),null);
 assert.equal(shortcodeFromHref('/@meta/post/DezZbXvEpqd'),'DezZbXvEpqd');assert.equal(shortcodeFromHref('/@meta/post/DezZ/media'),'DezZ');assert.equal(shortcodeFromHref('/@meta'),null);
});

test('only /@name/post/<code> pages are post pages; the author there is the page author whose replies are skipped',()=>{
 assert.deepEqual(pageContext('/@Meta/post/DezZbXvEpqd'),{kind:'post',author:'meta',shortcode:'DezZbXvEpqd'});
 assert.deepEqual(pageContext('/@meta/post/DezZbXvEpqd/'),{kind:'post',author:'meta',shortcode:'DezZbXvEpqd'});
 assert.deepEqual(pageContext('/@meta'),{kind:'other'});assert.deepEqual(pageContext('/'),{kind:'other'});assert.deepEqual(pageContext('/search'),{kind:'other'});
});

test('a reply container parses to its author, permalink and body text; names, times, counts and dots are not text',()=>{
 const r=reply({user:'anderson_vicu',code:'DezaddyEUsW',body:["It's a good idea for using it in Meta Quest",'Second paragraph here']});
 assert.deepEqual(parseContainer(r),{username:'anderson_vicu',shortcode:'DezaddyEUsW',text:"It's a good idea for using it in Meta Quest\nSecond paragraph here"});
 const op=reply({user:'meta',code:'DezZmOKFP0n',body:['She shares her process across @instagram'],op:true,mention:'instagram'});
 assert.equal(parseContainer(op).username,'meta','the first profile link, not the mention');
 assert.equal(parseContainer(op).text,'作者\nShe shares her process across @instagram','the dot is dropped; the 作者 badge rides along, harmless because the page author\'s replies are skipped');
 assert.equal(textOf(reply({user:'x',code:'c',body:[]})),'');
});

test('a container without an author link parses to null; nested containers belong to themselves',()=>{
 assert.equal(parseContainer(node('div',{'data-pressable-container':'true'},[span('no links here')])),null);
 const inner=reply({user:'quoted_user',code:'Q1',body:['quoted text']});
 const outer=node('div',{'data-pressable-container':'true'},[node('div',{},[a('/@outer_user',[span('outer_user')]),span([a('/@outer_user/post/O1',[node('time',{},['1 分鐘'])])]),span('outer body text'),inner])]);
 assert.deepEqual(parseContainer(outer),{username:'outer_user',shortcode:'O1',text:'outer body text'});
 assert.equal(parseContainer(inner).username,'quoted_user');
});

test('health: ten or more post links with no readable author means the layout changed; fewer is unknown',()=>{
 assert.equal(HEALTH_MIN_PERMALINKS,10);
 assert.equal(healthVerdict({permalinks:12,parsed:0}),'broken');assert.equal(healthVerdict({permalinks:12,parsed:3}),'ok');
 assert.equal(healthVerdict({permalinks:3,parsed:0}),'unknown');assert.equal(healthVerdict({permalinks:0,parsed:0}),'unknown');
});

test('the selectors are the structural anchors measured on 2026-10-21 (plan §1.2), not class names',()=>{
 assert.equal(CONTAINER_SELECTOR,'div[data-pressable-container="true"]');assert.equal(AUTHOR_SELECTOR,'a[href^="/@"]');assert.equal(PERMALINK_SELECTOR,'a[href*="/post/"]');
});

test('the thread root holds the main post and its replies, not the related threads one level up (measured 2026-10-23)',()=>{
 const main=reply({user:'meta',code:'M1',body:['main post']}),r1=reply({user:'a1',code:'R1',body:['reply one']}),r2=reply({user:'a2',code:'R2',body:['reply two']});
 const related1=reply({user:'other',code:'X1',body:['related']}),related2=reply({user:'other',code:'X2',body:['related two']});
 const threadColumn=node('div',{},[node('div',{},[node('div',{},[main])]),node('div',{},[r1]),node('div',{},[r2])]);
 const pageColumn=node('div',{},[threadColumn,node('div',{},[span('相關串文'),node('div',{},[related1]),node('div',{},[related2])])]);
 node('div',{id:'body'},[pageColumn]);
 const root=threadRootOf(main);
 assert.equal(root,threadColumn);
 const inRoot=root.querySelectorAll(CONTAINER_SELECTOR);
 assert.deepEqual(inRoot.map(c=>parseContainer(c).username),['meta','a1','a2'],'related posts are outside');
 assert.equal(threadRootOf(node('div',{'data-pressable-container':'true'},[])),null,'a detached container has no root');
});
