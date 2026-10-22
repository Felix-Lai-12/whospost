// Landing with ?u=<account> (the browser extension's "check this account on Whospost" link opens /?u=<name>&from=ext)
// only fills the search box; nothing is submitted until the visitor presses the button. `from` is read by analytics.mjs.
import {accountFromInput} from '../../shared/account-input.mjs';
/** The text to put in the search box for this page address: @handle, bare name and profile link all become "@name";
 *  '' when there is nothing valid to fill, so a bad link lands on the plain home page without an error. */
export function prefilledInput(search){
 const u=new URLSearchParams(search).get('u');
 if(!u)return '';
 try{return `@${accountFromInput(u)}`;}catch{return '';}
}
