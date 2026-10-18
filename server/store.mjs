import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {StoreCore} from './store-core.mjs';
// Node runtime: node:sqlite file or ':memory:'. The Worker uses the same core on Durable Object SQLite.
export class Store extends StoreCore{
 constructor(path,options={}){
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
  const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL');
  const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
  super(db,{...options,tx});
 }
 close(){this.db.close();}
}
