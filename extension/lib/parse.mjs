// Reading a reply out of Threads' DOM by structure only, never by class name (§6.3, facts measured 2026-10-21):
// a post or reply is div[data-pressable-container="true"]; its author is the first a[href^="/@"] that belongs to it;
// its permalink is a[href*="/post/"]. The interface is "give me a container, get {username, shortcode, text}" so
// a later source (§6.4 B) can replace this file without touching the engine.
export const CONTAINER_SELECTOR='div[data-pressable-container="true"]';
export const AUTHOR_SELECTOR='a[href^="/@"]';
export const PERMALINK_SELECTOR='a[href*="/post/"]';
export const HEALTH_MIN_PERMALINKS=10;
const USERNAME_PATH=/^\/@([a-zA-Z0-9_.]{1,30})\/?$/,POST_PATH=/^\/@([a-zA-Z0-9_.]{1,30})\/post\/([A-Za-z0-9_-]+)\/?/;
const pathOf=href=>{const s=String(href??'');if(s.startsWith('/'))return s.split(/[?#]/)[0];try{const u=new URL(s);return /(^|\.)threads\.(com|net)$/.test(u.hostname)?u.pathname:null;}catch{return null;}};
/** The lowercase username a profile link points at (/@name, with or without a trailing slash, relative or on a
 *  threads.com host), or null for anything else, including post links. */
export const usernameFromHref=href=>{const p=pathOf(href);const m=p&&p.match(USERNAME_PATH);return m?m[1].toLowerCase():null;};
/** The shortcode of a post link (/@name/post/<code>), or null. */
export const shortcodeFromHref=href=>{const p=pathOf(href);const m=p&&p.match(POST_PATH);return m?m[2]:null;};
/** What page the content script is on: a post page (replies are processed) or anything else (nothing is). */
export function pageContext(pathname){
 const m=String(pathname??'').match(POST_PATH);
 return m?{kind:'post',author:m[1].toLowerCase(),shortcode:m[2]}:{kind:'other'};
}
const NUMERIC=/^[\d.,]+\s*[KkMm萬]?$/,READABLE=/[\p{L}\p{N}]/u;
/** The reply's own text: every top-level span[dir="auto"] (or [lang] block) that belongs to this container and is not
 *  a link, a timestamp, a bare number or punctuation only (measured 2026-10-23: the body is one or more top-level
 *  span[dir="auto"]; the author name sits in a link, the time in a span holding <time>, the counts are bare numbers),
 *  joined with newlines. '' when nothing readable is found. */
export function textOf(container){
 const own=el=>el.closest('[data-pressable-container]')===container;
 const blocks=[...container.querySelectorAll('[lang]')].filter(el=>own(el)&&!el.closest('a[href]')&&!el.querySelector('time')&&!el.parentElement?.closest('[lang]'));
 const spans=blocks.length?blocks:[...container.querySelectorAll('span[dir="auto"]')].filter(el=>own(el)&&!el.closest('a[href]')&&!el.querySelector('time')&&!el.parentElement?.closest('span[dir="auto"]'));
 return spans.map(el=>String(el.textContent??'').trim()).filter(t=>READABLE.test(t)&&!NUMERIC.test(t)).join('\n');
}
/** {username, shortcode, text} for one container, or null when no author link belongs to it. */
export function parseContainer(container){
 const own=el=>el.closest('[data-pressable-container]')===container;
 let username=null;
 for(const a of container.querySelectorAll(AUTHOR_SELECTOR)){if(!own(a))continue;username=usernameFromHref(a.getAttribute('href'));if(username)break;}
 if(!username)return null;
 let shortcode=null;
 for(const a of container.querySelectorAll(PERMALINK_SELECTOR)){if(!own(a))continue;shortcode=shortcodeFromHref(a.getAttribute('href'));if(shortcode)break;}
 return {username,shortcode,text:textOf(container)};
}
/** The element that holds the main post and its replies but not the "相關串文" (related threads) rendered further
 *  down the same page: the lowest ancestor of the main post's container that holds at least one other container
 *  (measured 2026-10-23: replies join the main post one level below where related threads join). null when the
 *  main post has no such ancestor. Language-independent, so a renamed heading changes nothing. */
export function threadRootOf(mainContainer){
 let root=mainContainer?.parentElement??null;
 while(root&&root.querySelectorAll(CONTAINER_SELECTOR).length<2)root=root.parentElement;
 return root;
}
/** Health check (§6.3, KillSlop's LinkedIn lesson): a page with at least HEALTH_MIN_PERMALINKS post links but not one
 *  container whose author could be read means the layout changed. Fewer links is too little to judge. */
export function healthVerdict({permalinks,parsed}){
 if(permalinks<HEALTH_MIN_PERMALINKS)return 'unknown';
 return parsed===0?'broken':'ok';
}
