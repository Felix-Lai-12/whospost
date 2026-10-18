import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {AiStoreCore} from './store-core.mjs';
export class AiStore extends AiStoreCore{
 constructor(path,options){
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
  const db=new DatabaseSync(path);
  if(db.prepare("SELECT name FROM sqlite_master WHERE name='scans'").get()){db.close();throw Error('AI ledger must not use the scan database');}
  db.exec('PRAGMA journal_mode=WAL;PRAGMA busy_timeout=3000');
  const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
  super(db,{...options,tx});
  if(path!==':memory:')chmodSync(path,0o600);
 }
 close(){this.db.close();}
}
