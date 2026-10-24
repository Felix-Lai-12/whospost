// A small ZIP writer (deflate, no dependencies) for the extension package. Entries are written in the order given,
// with one fixed timestamp, so the same tree always produces the same archive. Node's zlib has crc32 since 22.2.
import zlib from 'node:zlib';
// 2026-01-01 00:00 in DOS date/time: the Web Store does not care about mtimes; a fixed one keeps the zip reproducible.
const DOS_TIME=0,DOS_DATE=((2026-1980)<<9)|(1<<5)|1;
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;},u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b;};
/** Builds a ZIP from [{name, data}] (name with forward slashes, data a Buffer). Returns the archive as a Buffer. */
export function zipEntries(entries){
 const locals=[],centrals=[];let offset=0;
 for(const {name,data} of entries){
  const nameBuf=Buffer.from(name,'utf8'),crc=zlib.crc32(data)>>>0,deflated=zlib.deflateRawSync(data,{level:9});
  const store=deflated.length>=data.length,body=store?data:deflated,method=store?0:8;
  const head=Buffer.concat([u32(0x04034b50),u16(20),u16(0x0800),u16(method),u16(DOS_TIME),u16(DOS_DATE),u32(crc),u32(body.length),u32(data.length),u16(nameBuf.length),u16(0),nameBuf]);
  locals.push(head,body);
  centrals.push(Buffer.concat([u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(method),u16(DOS_TIME),u16(DOS_DATE),u32(crc),u32(body.length),u32(data.length),u16(nameBuf.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),nameBuf]));
  offset+=head.length+body.length;
 }
 const central=Buffer.concat(centrals);
 const end=Buffer.concat([u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),u32(central.length),u32(offset),u16(0)]);
 return Buffer.concat([...locals,central,end]);
}
/** The entry names and sizes of a ZIP buffer, read from its central directory (enough to check a package). */
export function zipList(buf){
 const end=buf.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
 if(end<0)throw new Error('not a zip');
 const count=buf.readUInt16LE(end+10);let p=buf.readUInt32LE(end+16);const out=[];
 for(let i=0;i<count;i++){
  if(buf.readUInt32LE(p)!==0x02014b50)throw new Error('bad central directory');
  const nameLen=buf.readUInt16LE(p+28),extraLen=buf.readUInt16LE(p+30),commentLen=buf.readUInt16LE(p+32);
  out.push({name:buf.toString('utf8',p+46,p+46+nameLen),size:buf.readUInt32LE(p+24),method:buf.readUInt16LE(p+10)});
  p+=46+nameLen+extraLen+commentLen;
 }
 return out;
}
