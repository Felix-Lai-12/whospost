// Rendered preview cards, one row per scan. Rendering takes 0.1–0.7 s of CPU on Workers, above the Free plan's
// 10 ms per Worker request, so it runs in this Durable Object (30 s per request) once per card version, and
// later requests read the stored PNG. Kept free of cloudflare:workers imports so Node tests can drive it.
import {doSql} from './do-sql.mjs';
import {cardVersion} from './og-card.mjs';
const MAX_IMAGES=5000; // ~60 KB each, well inside the object's storage

export class OgImageCore{
 constructor(ctx,{render}){
  this.db=doSql(ctx.storage);this.render=render;
  this.db.exec('CREATE TABLE IF NOT EXISTS og_images(scan_id TEXT PRIMARY KEY,version TEXT NOT NULL,png BLOB NOT NULL,created_at INTEGER NOT NULL)');
 }
 /** PNG bytes for this scan's card: the stored image when its version matches, else a fresh render. */
 async png(scanId,card){
  const version=cardVersion(card),hit=this.db.prepare('SELECT png FROM og_images WHERE scan_id=? AND version=?').get(scanId,version);
  if(hit)return new Uint8Array(hit.png);
  const png=await this.render(card); // ArrayBuffer: Durable Object SQL binds BLOBs as ArrayBuffer
  this.db.prepare('INSERT OR REPLACE INTO og_images(scan_id,version,png,created_at) VALUES(?,?,?,?)').run(scanId,version,png,Date.now());
  this.db.prepare('DELETE FROM og_images WHERE scan_id IN (SELECT scan_id FROM og_images ORDER BY created_at DESC LIMIT -1 OFFSET ?)').run(MAX_IMAGES);
  return new Uint8Array(png);
 }
}
