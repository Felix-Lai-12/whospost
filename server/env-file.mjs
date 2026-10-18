import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// Secrets come from the process environment first, then from a local env file
// (WHOSPOST_ENV_FILE, default ./.env.local). Values are never logged or returned to clients.
export function envFilePath(env=process.env){const p=env.WHOSPOST_ENV_FILE;return p?resolve(p.replace(/^~(?=\/)/,homedir())):resolve(root,'.env.local');}
export function readSecret(name,env=process.env){
 if(env[name])return env[name];
 try{
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const m=readFileSync(envFilePath(env),'utf8').match(new RegExp(`^\\s*(?:export\\s+)?${escaped}\\s*=\\s*(.*?)\\s*$`,'m'));
  return m?m[1].replace(/^(['"])(.*)\1$/,'$2')||null:null;
 }catch{return null;}
}
