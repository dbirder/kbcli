import test from 'node:test';
import assert from 'node:assert/strict';
import {dropZoneForPoint} from '../../extensions/chrome-kb/navigation-ui.mjs';
const rail={left:0,right:200,top:10,bottom:60};
const zone=(name,left,right)=>({name,getBoundingClientRect:()=>({left,right,top:15,bottom:55})});
test('stationary pointer resolves the newly visible group after horizontal auto-scroll',()=>{
  const pointer={x:150,y:30},first=zone('first',100,180),last=zone('last',220,300);
  assert.equal(dropZoneForPoint(pointer,rail,[first,last]),first);
  first.getBoundingClientRect=()=>({left:-20,right:60,top:15,bottom:55});
  last.getBoundingClientRect=()=>({left:100,right:180,top:15,bottom:55});
  assert.equal(dropZoneForPoint(pointer,rail,[first,last]),last);
});
test('a clipped or departed pill cannot remain the release target',()=>{
  const old=zone('old',180,280);
  assert.equal(dropZoneForPoint({x:240,y:30},rail,[old]),null);
  assert.equal(dropZoneForPoint({x:190,y:80},rail,[old]),null);
  assert.equal(dropZoneForPoint({x:95,y:30},rail,[zone('a',0,80),zone('b',110,190)]),null);
});
