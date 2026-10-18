// Gives Durable Object SQLite the small node:sqlite surface the shared stores use:
// exec(sql) for schema, prepare(sql).get/all/run for statements. run() reports changes like node:sqlite.
export function doSql(storage){
 const sql=storage.sql;
 return {
  exec(text){for(const statement of text.split(';').map(s=>s.trim()).filter(Boolean))sql.exec(statement);},
  prepare(text){return {
   get:(...params)=>sql.exec(text,...params).toArray()[0],
   all:(...params)=>sql.exec(text,...params).toArray(),
   run:(...params)=>{sql.exec(text,...params).toArray();return {changes:sql.exec('SELECT changes() AS n').one().n};}
  };}
 };
}
