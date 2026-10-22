import test from 'node:test';
import assert from 'node:assert/strict';
import {insertionForPoint} from '../../extensions/chrome-kb/navigation-ui.mjs';
const bounds={left:0,right:350,top:0,bottom:300};
const card=(id,x,y)=>({id,rect:{left:x,right:x+90,top:y,bottom:y+100}});
const cards=[card('a',10,10),card('b',120,10),card('c',230,10),card('d',10,140),card('e',120,140)];
test('grid chooses before and after by card midpoint, including row wrap',()=>{
 assert.equal(insertionForPoint({x:20,y:50},bounds,cards).beforeId,'a');
 assert.equal(insertionForPoint({x:80,y:50},bounds,cards).beforeId,'b');
 assert.equal(insertionForPoint({x:300,y:50},bounds,cards).beforeId,'d');
 assert.equal(insertionForPoint({x:250,y:180},bounds,cards).beforeId,null);
});
test('vertical row gaps, first and final whitespace map to stable insertion positions',()=>{
 assert.equal(insertionForPoint({x:300,y:5},bounds,cards).beforeId,'a');
 assert.equal(insertionForPoint({x:20,y:125},bounds,cards).beforeId,'d');
 assert.equal(insertionForPoint({x:20,y:280},bounds,cards).beforeId,null);
});
test('release outside scroll viewport cannot use a previously highlighted position',()=>{
 assert.equal(insertionForPoint({x:20,y:-1},bounds,cards),null);
 assert.equal(insertionForPoint({x:351,y:50},bounds,cards),null);
 assert.equal(insertionForPoint(null,bounds,cards),null);
});
test('empty folder accepts a visible release at its only position',()=>{
 assert.equal(insertionForPoint({x:100,y:100},bounds,[]).beforeId,null);
 assert.equal(insertionForPoint({x:100,y:301},bounds,[]),null);
});
test('scrolled cards use current viewport geometry rather than cached layout',()=>{
 const shifted=cards.map(c=>({id:c.id,rect:{...c.rect,top:c.rect.top-120,bottom:c.rect.bottom-120}}));
 assert.equal(insertionForPoint({x:20,y:50},bounds,shifted).beforeId,'d');
});
