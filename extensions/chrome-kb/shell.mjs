import {showDialog} from './ui.mjs';
const $=id=>document.getElementById(id);
export function initShell() {
  const drawer=$('knowledge-panel'),trigger=$('knowledge-toggle');
  function state(open){document.body.classList.toggle('knowledge-open',open);trigger.setAttribute('aria-expanded',String(open));}
  trigger.addEventListener('click',()=>{if(drawer.open){drawer.close();return;}showDialog('knowledge-panel','knowledge-toggle');state(true);});
  drawer.addEventListener('close',()=>state(false));
  return {preferences(p){if(!p.showKnowledge&&drawer.open)drawer.close();}};
}
