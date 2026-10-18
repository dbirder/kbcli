import test from 'node:test';
import assert from 'node:assert/strict';
import {protectDialogSecret} from '../../extensions/chrome-kb/ui.mjs';
test('Escape clears a secret synchronously, before the later native close event',()=>{
  const dialog=new EventTarget(),input={value:'private'},close=protectDialogSecret(dialog,input,()=>false);
  dialog.dispatchEvent(new Event('cancel',{cancelable:true}));
  assert.equal(input.value,'');
  input.value='private';dialog.close=()=>assert.equal(input.value,'');close();
});
test('an in-flight connection cannot be accidentally cancelled; explicit completion still clears',()=>{
  const dialog=new EventTarget(),input={value:'private'},close=protectDialogSecret(dialog,input,()=>true);
  const event=new Event('cancel',{cancelable:true});dialog.dispatchEvent(event);
  assert.equal(event.defaultPrevented,true);assert.equal(input.value,'private');
  dialog.close=()=>assert.equal(input.value,'');close();
});
test('a native programmatic close also clears retained secrets',()=>{
  const dialog=new EventTarget(),input={value:'private'};protectDialogSecret(dialog,input,()=>false);
  dialog.dispatchEvent(new Event('close'));assert.equal(input.value,'');
});

import {bindLightDismiss} from '../../extensions/chrome-kb/ui.mjs';
function lightDismissFixture() {
  const dialog=new EventTarget();dialog.open=true;let closes=0;
  dialog.setAttribute=(key,value)=>{dialog[key]=value;};
  dialog.getBoundingClientRect=()=>({left:100,right:300,top:100,bottom:300});
  dialog.close=()=>{dialog.open=false;closes++;dialog.dispatchEvent(new Event('close'));};
  const fire=(type,x,y,{inside=false,button=0}={})=>{
    const event=new Event(type,{cancelable:true,bubbles:true});
    Object.defineProperties(event,{clientX:{value:x},clientY:{value:y},button:{value:button},isPrimary:{value:true}});
    if(inside)Object.defineProperty(event,'target',{value:{parentElement:dialog}});
    dialog.dispatchEvent(event);return event;
  };
  return {dialog,fire,get closes(){return closes;}};
}
test('fallback outside click issues a cancelable request and clears secrets before closing',()=>{
  const f=lightDismissFixture(),input={value:'private'};bindLightDismiss(f.dialog,{nativeSupported:false});protectDialogSecret(f.dialog,input,()=>false);
  f.dialog.close=()=>{assert.equal(input.value,'');f.dialog.open=false;};
  f.fire('pointerdown',50,50);const click=f.fire('click',50,50);assert.equal(f.dialog.open,false);assert.equal(click.defaultPrevented,true);
});
test('fallback does not close on padding, inner controls, or dragging text from inside to outside',()=>{
  const f=lightDismissFixture();bindLightDismiss(f.dialog,{nativeSupported:false});
  f.fire('pointerdown',110,110);f.fire('click',110,110);
  f.fire('pointerdown',160,160,{inside:true});f.fire('click',160,160,{inside:true});
  f.fire('pointerdown',160,160,{inside:true});f.fire('click',50,50);
  f.fire('pointerdown',50,50);f.fire('click',160,160,{inside:true});
  assert.equal(f.closes,0);
  f.fire('pointerdown',50,50);f.fire('click',50,50);assert.equal(f.closes,1);
});
test('fallback outside dismissal respects busy guards and cancels interrupted pointer gestures',()=>{
  const f=lightDismissFixture(),input={value:'private'};let busy=true;bindLightDismiss(f.dialog,{nativeSupported:false});protectDialogSecret(f.dialog,input,()=>busy);
  f.fire('pointerdown',50,50);f.fire('click',50,50);assert.equal(f.closes,0);assert.equal(input.value,'private');
  busy=false;f.fire('pointerdown',50,50);f.fire('pointercancel',50,50);f.fire('click',50,50);assert.equal(f.closes,0);
  f.fire('pointerdown',50,50,{button:2});f.fire('click',50,50);assert.equal(f.closes,0);
});
test('native closedby uses declarative dismissal without a second fallback close',()=>{
  const f=lightDismissFixture();bindLightDismiss(f.dialog,{nativeSupported:true});assert.equal(f.dialog.closedby,'any');
  f.fire('pointerdown',50,50);f.fire('click',50,50);assert.equal(f.closes,0);
});
