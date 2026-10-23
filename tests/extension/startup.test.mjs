import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../../extensions/chrome-kb/startup.js',import.meta.url),'utf8');
function boot(values={},blocked=false){
 const dataset={},style=new Map(),meta={},marks=[];let timeout,cleared=0;
 const context={document:{documentElement:{dataset,style:{setProperty:(k,v)=>style.set(k,v)}},querySelector:()=>meta},window:{},localStorage:{getItem:key=>{if(blocked)throw Error('blocked');return values[key]??null;}},setTimeout:(callback,ms)=>{assert.equal(ms,4000);timeout=callback;return 7;},clearTimeout:id=>{assert.equal(id,7);cleared++;},performance:{mark:name=>marks.push(name)}};
 runInNewContext(source,context);return {dataset,style,meta,marks,finish:context.window.kbStartup.finish,timeout:()=>timeout(),cleared:()=>cleared};
}
test('first paint uses saved scheme and validated local preview before modules',()=>{
 const b=boot({'kb-first-paint-scheme':'light','kb-first-paint-background':JSON.stringify({assetVersion:2,image:'data:image/webp;base64,UklGRg==',position:'top'})});
 assert.equal(b.dataset.colorScheme,'light');assert.equal(b.meta.content,'light');assert.equal(b.dataset.startup,'pending');assert.equal(b.style.get('--startup-position'),'top');assert.match(b.style.get('--startup-wallpaper'),/^url\("data:image\/webp/);
 b.finish();b.timeout();assert.equal(b.dataset.startup,undefined);assert.equal(b.cleared(),1);assert.deepEqual(b.marks,['kb:first-view-ready']);
});
test('startup has a bounded fail-open when modules fail',()=>{const b=boot();b.timeout();assert.equal(b.dataset.startup,undefined);assert.equal(b.marks.length,1);});
test('blocked cache storage does not prevent startup or fallback',()=>{const b=boot({},true);assert.equal(b.dataset.startup,'pending');b.timeout();assert.equal(b.dataset.startup,undefined);});
test('cache cannot inject external images or unsupported color schemes',()=>{const b=boot({'kb-first-paint-scheme':'red','kb-first-paint-background':JSON.stringify({image:'https://example.com/tracker.webp'})});assert.equal(b.dataset.colorScheme,undefined);assert.equal(b.style.size,0);});
test('malformed previews are ignored',()=>{const b=boot({'kb-first-paint-background':'bad json'});assert.equal(b.style.size,0);b.finish();});
