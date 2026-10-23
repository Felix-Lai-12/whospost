// The popup's "check an account" box accepts @name, name or a profile link, like the site's own search box.
export function accountFromInputLoose(raw){
 let s=String(raw??'').trim();
 if(!s)return null;
 try{if(/^https?:\/\//i.test(s)){const u=new URL(s);s=u.pathname;}}catch{return null;}
 s=s.replace(/^\/+/,'').replace(/^@/,'').split(/[/?#]/)[0];
 return /^[A-Za-z0-9_.]{1,30}$/.test(s)?s.toLowerCase():null;
}
