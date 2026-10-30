// Remote switches for the browser extension, answered inside /api/health (`extension`). The extension reads them about
// once an hour and hides a feature whose switch is off, so the site can stop it without a new extension release.
// block (EXTENSION-SPEC §4.5): the 封鎖助手 button in the popover; WHOSPOST_EXTENSION_BLOCK="0" turns it off.
// replies (plan-extension-replies 2026-10-29): reading the account's replies in the user's browser after 「AI 打詐」 and
// sending them back (POST /api/scans/:id/replies, shadow mode). Off unless WHOSPOST_EXTENSION_REPLIES="1": it uses the
// user's own Threads session, so it waits for the store review and the privacy disclosure. repliesQuery is data only,
// never code (the store forbids remote code): Threads' query id for the Replies tab, which it changes from time to time
// (28839919525648597 on 2026-10-29; WHOSPOST_REPLIES_DOC_ID replaces it without a release), and the page size.
export const REPLIES_DOC_ID='28839919525648597',REPLIES_PAGE=25;
export function extensionFlags(env={}){
 const docId=/^\d{10,25}$/.test(env.WHOSPOST_REPLIES_DOC_ID??'')?env.WHOSPOST_REPLIES_DOC_ID:REPLIES_DOC_ID;
 return {block:env.WHOSPOST_EXTENSION_BLOCK!=='0',replies:env.WHOSPOST_EXTENSION_REPLIES==='1',repliesQuery:{docId,first:REPLIES_PAGE}};
}
