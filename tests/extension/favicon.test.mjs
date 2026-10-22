import test from 'node:test';
import assert from 'node:assert/strict';
import {faviconSources} from '../../extensions/chrome-kb/favicon.mjs';
test('favicon requests contain only the site origin, including private-network ports',()=>{
  const runtime={getURL:path=>'chrome-extension://test-id'+path};
  for(const site of ['https://example.com/private?token=secret#private','http://192.168.6.1:9999/ui/?token=secret']){
    const result=faviconSources(site,runtime,32),cached=new URL(result.cached);
    assert.equal(cached.searchParams.get('pageUrl'),new URL(site).origin+'/');
    assert.equal(result.direct,new URL(site).origin+'/favicon.ico');
    assert.equal(cached.searchParams.get('size'),'32');assert.ok(!JSON.stringify(result).includes('secret'));
  }
});

test('a page session shares a single bitmap request across paths, previews and concurrent consumers',async()=>{
  const {createFaviconCache}=await import('../../extensions/chrome-kb/favicon.mjs');
  const requests=[],bitmap={tag:'decoded bitmap'};
  const cache=createFaviconCache({load:async url=>{requests.push(url);return bitmap;},isDefault:async()=>false});
  const runtime={getURL:path=>'chrome-extension://test-id'+path};
  const [a,b]=await Promise.all([cache.get('https://example.com/a?q=secret',runtime),cache.get('https://example.com/b',runtime)]);
  assert.equal(a,bitmap);assert.equal(b,bitmap);assert.equal(cache.peek('https://example.com/d',runtime),bitmap);assert.equal(await cache.get('https://example.com/c',runtime),bitmap);assert.equal(requests.length,1);
});
test('default and missing icons are resolved once and negative results stay cached until page refresh',async()=>{
  const {createFaviconCache}=await import('../../extensions/chrome-kb/favicon.mjs');
  const runtime={getURL:path=>'chrome-extension://test-id'+path},requests=[];
  const cache=createFaviconCache({load:async url=>{requests.push(url);return url.includes('_favicon')?{default:true}:null;},isDefault:async image=>image.default});
  assert.equal(await cache.get('https://example.com',runtime),null);
  assert.equal(await cache.get('https://example.com/path',runtime),null);
  assert.equal(requests.length,2);assert.equal(requests[1],'https://example.com/favicon.ico');
  const retry=createFaviconCache({load:async()=>({fresh:true}),isDefault:async()=>false});
  assert.deepEqual(await retry.get('https://example.com',runtime),{fresh:true});
});


test('source checks are bounded across many domains',async()=>{
  const {createFaviconCache}=await import('../../extensions/chrome-kb/favicon.mjs');
  let active=0,maximum=0;
  const cache=createFaviconCache({load:async()=>{active++;maximum=Math.max(maximum,active);await new Promise(setImmediate);active--;return {};},isDefault:async()=>false});
  const runtime={getURL:path=>'chrome-extension://test-id'+path};
  await Promise.all(Array.from({length:12},(_,i)=>cache.get(`https://site${i}.example`,runtime)));
  assert.equal(maximum,4);assert.equal(active,0);
});
