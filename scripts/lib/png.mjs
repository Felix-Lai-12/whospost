// Minimal PNG read/write for the store assets, dependency-free: reads 8-bit RGB/RGBA non-interlaced PNGs (what
// Playwright's Chromium writes) and writes 24-bit RGB without an alpha channel, which the Chrome Web Store asks for
// in screenshots ("24-bit PNG, no alpha"). Nothing else: no palettes, no 16-bit, no interlace.
import zlib from 'node:zlib';
const SIG=Buffer.from([137,80,78,71,13,10,26,10]);
/** Width, height, bit depth and colour type of a PNG buffer (the IHDR), without decoding the pixels. */
export function pngInfo(buf){
 if(!buf.subarray(0,8).equals(SIG))throw new Error('not a PNG');
 if(buf.toString('latin1',12,16)!=='IHDR')throw new Error('IHDR missing');
 return {width:buf.readUInt32BE(16),height:buf.readUInt32BE(20),bitDepth:buf[24],colorType:buf[25],interlace:buf[28]};
}
/** Decodes to {width, height, channels, data} with 8-bit samples; channels is 3 (RGB) or 4 (RGBA). */
export function decodePng(buf){
 const {width,height,bitDepth,colorType,interlace}=pngInfo(buf);
 if(bitDepth!==8||![2,6].includes(colorType)||interlace!==0)throw new Error(`unsupported PNG (bit depth ${bitDepth}, colour type ${colorType}, interlace ${interlace})`);
 const channels=colorType===6?4:3,idat=[];
 for(let p=8;p<buf.length;){const len=buf.readUInt32BE(p),type=buf.toString('latin1',p+4,p+8);if(type==='IDAT')idat.push(buf.subarray(p+8,p+8+len));if(type==='IEND')break;p+=12+len;}
 const raw=zlib.inflateSync(Buffer.concat(idat)),stride=width*channels,out=Buffer.alloc(height*stride);
 for(let y=0;y<height;y++){
  const f=raw[y*(stride+1)],src=raw.subarray(y*(stride+1)+1,(y+1)*(stride+1)),row=out.subarray(y*stride,(y+1)*stride),prev=y?out.subarray((y-1)*stride,y*stride):null;
  for(let i=0;i<stride;i++){
   const a=i>=channels?row[i-channels]:0,b=prev?prev[i]:0,c=prev&&i>=channels?prev[i-channels]:0;let v=src[i];
   if(f===1)v+=a;else if(f===2)v+=b;else if(f===3)v+=(a+b)>>1;else if(f===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);v+=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}else if(f!==0)throw new Error(`bad filter ${f}`);
   row[i]=v&255;
  }
 }
 return {width,height,channels,data:out};
}
const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type,'latin1'),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(zlib.crc32(td)>>>0);return Buffer.concat([len,td,crc]);};
/** Encodes 8-bit RGB (channels 3) or RGBA (4) pixels as a PNG. */
export function encodePng({width,height,channels,data}){
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=channels===4?6:2;
 const stride=width*channels,raw=Buffer.alloc(height*(stride+1));
 for(let y=0;y<height;y++){raw[y*(stride+1)]=0;data.copy(raw,y*(stride+1)+1,y*stride,(y+1)*stride);}
 return Buffer.concat([SIG,chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
/** The same image as 24-bit RGB: alpha is composited over white, so a transparent corner comes out white, not black. */
export function toRgb24(buf){
 const img=decodePng(buf);
 if(img.channels===3)return encodePng(img);
 const {width,height,data}=img,rgb=Buffer.alloc(width*height*3);
 for(let i=0,o=0;i<data.length;i+=4,o+=3){const a=data[i+3]/255;rgb[o]=Math.round(data[i]*a+255*(1-a));rgb[o+1]=Math.round(data[i+1]*a+255*(1-a));rgb[o+2]=Math.round(data[i+2]*a+255*(1-a));}
 return encodePng({width,height,channels:3,data:rgb});
}
