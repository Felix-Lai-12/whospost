// Remote switches for the browser extension, answered inside /api/health (`extension`). The extension reads them about
// once an hour and hides a feature whose switch is off, so the site can stop it without a new extension release.
// block (EXTENSION-SPEC §4.5): the 封鎖助手 button in the popover; WHOSPOST_EXTENSION_BLOCK="0" turns it off.
export function extensionFlags(env={}){
 return {block:env.WHOSPOST_EXTENSION_BLOCK!=='0'};
}
