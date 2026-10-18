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
