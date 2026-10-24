// Packs extension/ into the zip the Chrome Web Store takes: dist/whospost-extension-<version>.zip, the version read
// from manifest.json. Only what the browser loads goes in (manifest, scripts, styles, popup, lib/, icons/); docs/,
// store/ and anything test-like stay out. lib/signals.mjs is a symlink to shared/signals.mjs in the repo — the zip
// holds the file itself, so the package stands alone. Same tree, same bytes (fixed timestamps, sorted names).
//   node scripts/pack-extension.mjs [--out <file>] [--quiet]
import fs from 'node:fs';
import path from 'node:path';
import {zipEntries,zipList} from './lib/zip.mjs';
const ROOT=path.resolve(import.meta.dirname,'..'),EXT=path.join(ROOT,'extension');
// Top-level names in extension/ that are not part of the package.
export const EXCLUDED=['docs','store','README.md','.DS_Store'];
const excluded=rel=>EXCLUDED.includes(rel.split('/')[0])||/(^|\/)(tests?|__tests__|e2e)(\/|$)/.test(rel)||/\.(test|spec)\.m?js$/.test(rel)||/(^|\/)\.[^/]+$/.test(rel);
function walk(dir,rel=''){
 const out=[];
 for(const name of fs.readdirSync(dir).sort()){
  const r=rel?`${rel}/${name}`:name;if(excluded(r))continue;
  const full=path.join(dir,name),st=fs.statSync(full); // statSync follows symlinks: the shared module comes in as a file
  if(st.isDirectory())out.push(...walk(full,r));else if(st.isFile())out.push({name:r,data:fs.readFileSync(full)});
 }
 return out;
}
/** Writes the package and returns {file, version, entries:[{name,size}], bytes}. */
export function packExtension({out=null,extDir=EXT}={}){
 const manifest=JSON.parse(fs.readFileSync(path.join(extDir,'manifest.json'),'utf8'));
 for(const f of [manifest.background?.service_worker,...(manifest.content_scripts??[]).flatMap(c=>[...(c.js??[]),...(c.css??[])]),manifest.action?.default_popup,...Object.values(manifest.icons??{})].filter(Boolean))
  if(!fs.existsSync(path.join(extDir,f)))throw new Error(`manifest names a missing file: ${f}`);
 const entries=walk(extDir),zip=zipEntries(entries);
 const file=path.resolve(out??path.join(ROOT,'dist',`whospost-extension-${manifest.version}.zip`));
 fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,zip);
 return {file,version:manifest.version,entries:zipList(zip).map(({name,size})=>({name,size})),bytes:zip.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
 const args=process.argv.slice(2),i=args.indexOf('--out');
 const r=packExtension({out:i>=0?args[i+1]:null});
 if(!args.includes('--quiet')){for(const e of r.entries)console.log(`${String(e.size).padStart(8)}  ${e.name}`);console.log(`\n${path.relative(process.cwd(),r.file)}  ${r.entries.length} files, ${(r.bytes/1024).toFixed(1)} KB (version ${r.version})`);}
}
