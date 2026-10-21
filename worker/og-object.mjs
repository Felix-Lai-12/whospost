// Rendered preview cards, one row per scan. Rendering takes 0.1–0.7 s of CPU on Workers, above the Free plan's
// 10 ms per Worker request, so it runs in this Durable Object (30 s per request) once per card version, and
// later requests read the stored PNG. The 1080×1080 avatar (avatar-card.mjs) has its own table so a scan keeps
// one of each. Kept free of cloudflare:workers imports so Node tests can drive it.
import {doSql} from './do-sql.mjs';
import {cardVersion} from './og-card.mjs';
import {avatarVersion} from './avatar-card.mjs';
const MAX_IMAGES=5000; // ~60 KB each (preview) / ~150 KB each (avatar), well inside the object's storage

export class OgImageCore{
 constructor(ctx,{render,renderAvatar}){
  this.db=doSql(ctx.storage);this.render=render;this.renderAvatar=renderAvatar;
  for(const table of ['og_images','avatar_images'])this.db.exec(`CREATE TABLE IF NOT EXISTS ${table}(scan_id TEXT PRIMARY KEY,version TEXT NOT NULL,png BLOB NOT NULL,created_at INTEGER NOT NULL)`);
 }
 async #stored(table,scanId,version,render){
  const hit=this.db.prepare(`SELECT png FROM ${table} WHERE scan_id=? AND version=?`).get(scanId,version);
  if(hit)return new Uint8Array(hit.png);
  const png=await render(); // ArrayBuffer: Durable Object SQL binds BLOBs as ArrayBuffer
  this.db.prepare(`INSERT OR REPLACE INTO ${table}(scan_id,version,png,created_at) VALUES(?,?,?,?)`).run(scanId,version,png,Date.now());
  this.db.prepare(`DELETE FROM ${table} WHERE scan_id IN (SELECT scan_id FROM ${table} ORDER BY created_at DESC LIMIT -1 OFFSET ?)`).run(MAX_IMAGES);
  return new Uint8Array(png);
 }
 /** PNG bytes for this scan's card: the stored image when its version matches, else a fresh render. */
 png(scanId,card){return this.#stored('og_images',scanId,cardVersion(card),()=>this.render(card));}
 /** PNG bytes for this scan's 1080×1080 avatar, stored and reused the same way. */
 avatarPng(scanId,card){return this.#stored('avatar_images',scanId,avatarVersion(card),()=>this.renderAvatar(card));}
}
