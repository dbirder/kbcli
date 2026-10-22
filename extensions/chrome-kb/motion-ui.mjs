import {animate} from './vendor/motion-14.6.0.mjs';

const states=new WeakMap();
let order=0;
export const motionAllowed=()=>document.documentElement.dataset.motion!=='reduce'&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
const floatingControl=()=>document.querySelector('.control-popover:popover-open,.group-picker:popover-open');
export function animateContent(element){
  if(motionAllowed()&&element)animate(element,{opacity:[.65,1],x:[6,0]},{duration:.16,ease:[.22,1,.36,1]});
}
export function requestDialogClose(dialog){
  if(!dialog.open||dialog.kbCanDismiss?.()===false)return;
  // The existing save/connection guards and secret clearing run synchronously.
  if(dialog.dispatchEvent(new Event('cancel',{cancelable:true})))void dialog.close();
}
export function installDialogMotion(dialog){
  if(states.has(dialog))return;
  const nativeClose=dialog.close.bind(dialog),nativeShow=dialog.showModal.bind(dialog);
  const state={enter:null,exit:null,closing:null,order:0,generation:0};states.set(dialog,state);
  dialog.setAttribute('closedby','closerequest');
  dialog.showModal=function(){
    if(dialog.open)return;
    state.order=++order;state.generation++;nativeShow();
    if(!motionAllowed()||dialog.classList.contains('drag-to-home'))return;
    state.enter=animate(dialog,{opacity:[0,1],y:[22,0]},{type:'spring',duration:.38,bounce:.12,opacity:{type:'keyframes',duration:.16,ease:'easeOut'}});
  };
  dialog.close=function(value){
    if(!dialog.open)return Promise.resolve();
    if(state.closing)return state.closing;
    const generation=state.generation,skipExit=!motionAllowed()||dialog.classList.contains('drag-to-home');
    state.enter?.stop();
    const r=dialog.getBoundingClientRect();
    dialog.style.width=r.width+'px';dialog.style.height=r.height+'px';dialog.style.minWidth=r.width+'px';
    dialog.dataset.kbClosing='';
    dialog.dispatchEvent(new Event('kb:closing'));
    state.closing=(async()=>{
      await Promise.resolve();
      try{
        if(!skipExit){
          state.exit=animate(dialog,{opacity:0,y:8},{duration:.14,ease:[.4,0,1,1]});
          // Background tabs can throttle animation ticks. Never strand a modal.
          let timer;try{await Promise.race([state.exit,new Promise(resolve=>{timer=setTimeout(resolve,800);})]);}finally{clearTimeout(timer);}
        }
        if(generation===state.generation&&dialog.open)nativeClose(value);
      }finally{
        state.exit?.stop();state.exit=null;state.enter=null;
        delete dialog.dataset.kbClosing;
        for(const key of ['width','height','minWidth','opacity','transform'])dialog.style[key]='';
        state.closing=null;
      }
    })();return state.closing;
  };
  const topmost=()=>[...document.querySelectorAll('dialog[open]')].sort((a,b)=>(states.get(a)?.order||0)-(states.get(b)?.order||0)).at(-1)===dialog;
  // Handle the key before repeated native close requests can force removal
  // from the top layer; let nested custom selects/date pickers handle it first.
  dialog.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||event.defaultPrevented||floatingControl()||!topmost())return;
    event.preventDefault();event.stopPropagation();requestDialogClose(dialog);
  });
  dialog.addEventListener('cancel',event=>{
    if(!event.isTrusted)return;
    event.preventDefault();requestDialogClose(dialog);
  });
  bindOutsideDismiss(dialog,{isTopmost:topmost,hasFloatingControl:floatingControl});
}

export function bindOutsideDismiss(dialog,{isTopmost=()=>true,hasFloatingControl=()=>false}={}){
  let startedOutside=false;
  const outside=event=>{const r=dialog.getBoundingClientRect();return event.target===dialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom);};
  dialog.addEventListener('pointerdown',event=>{startedOutside=isTopmost()&&!hasFloatingControl()&&event.button===0&&event.isPrimary!==false&&outside(event);});
  dialog.addEventListener('pointercancel',()=>startedOutside=false);
  dialog.addEventListener('close',()=>startedOutside=false);
  dialog.addEventListener('click',event=>{
    const dismiss=startedOutside&&outside(event);startedOutside=false;
    if(!dismiss||!dialog.open)return;
    event.preventDefault();event.stopPropagation();requestDialogClose(dialog);
  });
}
