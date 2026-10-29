import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=['background.js','bridge.js','collector.js','popup.html','popup.js','popup.css'];
function crc32(data){let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function zip(entries){
  const chunks=[],directory=[];let offset=0;
  for(const [filename,data] of entries){
    const name=Buffer.from(filename),crc=crc32(data),local=Buffer.alloc(30),central=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x21,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
    central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x21,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
    chunks.push(local,name,data);directory.push(central,name);offset+=local.length+name.length+data.length;
  }
  const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...chunks,central,end]);
}
await mkdir(path.join(root,'public/downloads'),{recursive:true});
for(const target of ['firefox','chromium']){
  const directory=path.join(root,'.extension-build',target);await mkdir(directory,{recursive:true});
  const entries=[['manifest.json',await readFile(path.join(root,'browser-extension',`manifest.${target}.json`))]];
  for(const filename of files)entries.push([filename,await readFile(path.join(root,'browser-extension',filename))]);
  for(const [name,data]of entries)await writeFile(path.join(directory,name),data);
  await writeFile(path.join(root,'public/downloads',`rockshowbot-${target}.zip`),zip(entries));
  console.log(`Extension ${target}: .extension-build/${target}/manifest.json and public/downloads/rockshowbot-${target}.zip`);
}
