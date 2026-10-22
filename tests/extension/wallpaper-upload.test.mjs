import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWallpaper,wallpaperMime} from '../../extensions/chrome-kb/appearance-ui.mjs';
const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]),jpeg=new Uint8Array([255,216,255,224,0,16,74,70,73,70,0,1]);
test('wallpaper signature accepts only supported raster formats, independent of filename hints',()=>{
 assert.equal(wallpaperMime(png),'image/png');assert.equal(wallpaperMime(jpeg),'image/jpeg');assert.equal(wallpaperMime(new TextEncoder().encode('RIFF0000WEBP')),'image/webp');
 for(const data of ['', '<svg/>','GIF89a','<html>','RIFF0000WAVE'])assert.equal(wallpaperMime(new TextEncoder().encode(data)),null);
});
test('JPEG named PNG decodes using actual MIME, is normalized to WebP, and releases the bitmap',async t=>{
 const prior={document:globalThis.document,createImageBitmap:globalThis.createImageBitmap};t.after(()=>Object.assign(globalThis,prior));let decodedType,closed=false;
 globalThis.createImageBitmap=async blob=>{decodedType=blob.type;return {width:2560,height:1440,close(){closed=true;}};};
 globalThis.document={createElement(){return {getContext(){return {drawImage(){}};},toDataURL(){return 'data:image/webp;base64,TEST';}};}};
 const file=new Blob([jpeg],{type:'image/png'});file.name='剑客-水墨.png';const result=await prepareWallpaper(file);
 assert.equal(decodedType,'image/jpeg');assert.equal(result.name,file.name);assert.ok(result.dataURL.startsWith('data:image/webp;base64,'));assert.ok(closed);
});
test('unsupported or oversized content is rejected before decoding; corrupt raster has a readable error',async t=>{
 const original=globalThis.createImageBitmap;t.after(()=>globalThis.createImageBitmap=original);let decodes=0;globalThis.createImageBitmap=async()=>{decodes++;throw Error('decode failed');};
 await assert.rejects(prepareWallpaper({size:15*1024*1024+1}),/15 MiB/);
 await assert.rejects(prepareWallpaper(new Blob(['<svg/>'],{type:'image/png'})),/不支持此图片内容/);assert.equal(decodes,0);
 await assert.rejects(prepareWallpaper(new Blob([png],{type:'image/png'})),/图片无法读取或已损坏/);assert.equal(decodes,1);
});
