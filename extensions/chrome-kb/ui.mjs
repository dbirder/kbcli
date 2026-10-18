const $ = id => document.getElementById(id);
const focusKey = key => [...document.querySelectorAll('[data-focus-key]')].find(n => n.dataset.focusKey === key);
function focus(node,fallback) {
  const target = node?.isConnected && !node.disabled ? node : fallback?.isConnected && !fallback.disabled ? fallback : $('settings-button');
  if (target && !target.disabled) target.focus({preventScroll:true});
}
export function preserveFocus(container) {
  const active = document.activeElement, key = container.contains(active) ? active.dataset.focusKey : null;
  return () => {
    if (!key || active.isConnected) return;
    const next = focusKey(key);
    const fallback = next?.closest('.site-card')?.querySelector('a') || next?.closest('.group-heading')?.querySelector('button:not(:disabled)') || container.querySelector('button:not(:disabled),a');
    focus(next,fallback);
  };
}
export function showDialog(id,fallbackId) {
  const dialog = $(id), opener = document.activeElement, key = opener?.dataset.focusKey;
  dialog.addEventListener('close',() => focus(key ? focusKey(key) : opener,$(fallbackId)),{once:true});
  dialog.showModal();
}
export function protectDialogSecret(dialog,input,isBusy) {
  const clear = () => { input.value=''; };
  dialog.addEventListener('cancel',event=>{ if(isBusy())event.preventDefault();else clear(); });
  dialog.addEventListener('close',clear);
  return () => { clear();dialog.close(); };
}
const fields = {
  'settings-form':{server:'server-input',token:'token-input'},
  'task-form':{title:'task-title',due:'task-due',tags:'task-tags',status:'task-status'},
  'site-form':{title:'site-title',url:'site-url',groupId:'site-group'},
  'group-form':{name:'group-name'},
};
const errorFields={TITLE_INVALID:'title',DATE_INVALID:'due',TAGS_INVALID:'tags',STATUS_INVALID:'status',SERVER_INVALID:'server',TOKEN_REQUIRED:'token',UNAUTHORIZED:'token',USER_TOKEN_REQUIRED:'token'};
export function showFormError(id,error) {
  const output=$(id), form=output.closest('form');
  if (form) for (const input of form.querySelectorAll('[aria-invalid]')) { input.removeAttribute('aria-invalid'); delete input.dataset.serverInvalid; }
  output.textContent=error?.message || ''; output.hidden=!error;
  const inputId=fields[form?.id]?.[error?.field || errorFields[error?.code]];
  if (error && inputId) { const input=$(inputId); input.dataset.serverInvalid='true'; input.setAttribute('aria-invalid','true'); input.focus(); }
}
export function bindValidation(formId,errorId) {
  const form=$(formId),output=$(errorId);
  for (const input of form.querySelectorAll('input,select')) input.setAttribute('aria-errormessage',errorId);
  const sync=input => {
    if (input.dataset.serverInvalid) return;
    if (input.matches(':user-invalid')) input.setAttribute('aria-invalid','true');
    else input.removeAttribute('aria-invalid');
  };
  form.addEventListener('invalid',event=>{event.target.setAttribute('aria-invalid','true');output.textContent=event.target.validationMessage;output.hidden=false;},true);
  form.addEventListener('blur',event=>{if(event.target.matches('input,select'))sync(event.target);},true);
  form.addEventListener('input',event=>{
    if (!event.target.matches('input,select')) return;
    delete event.target.dataset.serverInvalid;sync(event.target);
    if (!form.querySelector('[aria-invalid="true"]')) { output.textContent='';output.hidden=true; }
  });
}
