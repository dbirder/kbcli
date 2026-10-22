// Custom UI, stable form values. No native select/date picker is shown.
const $=id=>document.getElementById(id);
function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
function button(className,text,label){const node=element('button',className,text);node.type='button';if(label)node.setAttribute('aria-label',label);return node;}
export function parseDay(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const [y,m,d]=value.split('-').map(Number),date=new Date(0);date.setUTCFullYear(y,m-1,d);date.setUTCHours(0,0,0,0);
  return y>=1&&date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?date:null;
}
const iso=date=>`${String(date.getUTCFullYear()).padStart(4,'0')}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
function today(){const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;}
export function moveDay(value,days=0,months=0){
  const date=parseDay(value);if(!date)return null;
  if(months){const day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+months);const end=new Date(date);end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);date.setUTCDate(Math.min(day,end.getUTCDate()));}
  date.setUTCDate(date.getUTCDate()+days);return date.getUTCFullYear()>=1&&date.getUTCFullYear()<=9999?iso(date):null;
}
export function calendarDays(value){
  const date=parseDay(value);if(!date)return [];
  const month=date.getUTCMonth();date.setUTCDate(1);date.setUTCDate(1-(date.getUTCDay()+6)%7);
  return Array.from({length:42},()=>{const value=iso(date),cell={value,day:date.getUTCDate(),inMonth:date.getUTCMonth()===month,valid:date.getUTCFullYear()>=1&&date.getUTCFullYear()<=9999};date.setUTCDate(date.getUTCDate()+1);return cell;});
}
export function rangePercent(input){const min=Number(input.min)||0,max=Number(input.max)||100;return Math.max(0,Math.min(100,(Number(input.value)-min)/(max-min)*100));}
export function paintRange(input){input.style.setProperty('--range-fill',rangePercent(input)+'%');}
function popupFor(trigger,className,role,label){
  const popup=element('div','control-popover '+className);popup.id=trigger.id+'-popup';popup.setAttribute('popover','auto');popup.setAttribute('role',role);popup.setAttribute('aria-label',label);
  (trigger.closest('dialog')||document.body).append(popup);trigger.setAttribute('popovertarget',popup.id);trigger.setAttribute('aria-controls',popup.id);trigger.setAttribute('aria-expanded','false');
  const isOpen=()=>popup.matches(':popover-open');
  function place(){
    if(!isOpen())return;const r=(className==='date-picker'?trigger.closest('.date-control'):trigger).getBoundingClientRect(),vh=window.innerHeight,vw=document.documentElement.clientWidth;
    if(!r.width||r.bottom<0||r.top>vh){popup.hidePopover();return;}
    const width=Math.min(vw-24,Math.max(className==='date-picker'?310:220,r.width));popup.style.width=width+'px';
    const below=vh-r.bottom-14,above=r.top-14,up=below<Math.min(popup.scrollHeight,300)&&above>below,room=Math.max(120,up?above:below);
    popup.style.maxHeight=Math.min(className==='date-picker'?440:300,room)+'px';
    const height=popup.getBoundingClientRect().height;
    popup.style.left=Math.max(12,Math.min(r.left,vw-width-12))+'px';popup.style.top=Math.max(12,Math.min(up?r.top-height-8:r.bottom+8,vh-height-12))+'px';popup.style.visibility='visible';
  }
  popup.addEventListener('beforetoggle',event=>{trigger.setAttribute('aria-expanded',String(event.newState==='open'));if(event.newState==='open'){popup.style.visibility='hidden';requestAnimationFrame(place);}else trigger.removeAttribute('aria-activedescendant');});
  const dialog=trigger.closest('dialog');let dismissingPopover=false;
  // One outside gesture dismisses only the topmost control, preserving the form draft.
  document.addEventListener('pointerdown',event=>{
    dismissingPopover=false;if(event.button!==0||event.isPrimary===false||!dialog?.open||!isOpen())return;
    const r=dialog.getBoundingClientRect();dismissingPopover=!popup.contains(event.target)&&!trigger.contains(event.target)&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom);
  },true);
  document.addEventListener('pointercancel',()=>{dismissingPopover=false;},true);
  document.addEventListener('click',()=>{if(dismissingPopover)setTimeout(()=>{dismissingPopover=false;},0);},true);
  dialog?.addEventListener('cancel',event=>{if(dismissingPopover)event.preventDefault();});
  dialog?.addEventListener('close',()=>{dismissingPopover=false;if(isOpen())popup.hidePopover();});
  window.addEventListener('resize',place);document.addEventListener('scroll',event=>{if(!popup.contains(event.target))place();},true);
  return {popup,isOpen,place,close:()=>{if(isOpen())popup.hidePopover();}};
}
function enhanceSelect(select){
  const label=document.querySelector(`label[for="${select.id}"]`),name=label?.firstChild?.textContent.trim()||'选择选项';
  const wrap=element('span','select-control'),trigger=button('select-trigger','',name),value=element('span','select-value'),chevron=element('span','control-chevron');
  trigger.id=select.id+'-control';trigger.setAttribute('role','combobox');trigger.setAttribute('aria-haspopup','listbox');chevron.setAttribute('aria-hidden','true');trigger.append(value,chevron);
  select.before(wrap);wrap.append(select,trigger);select.classList.add('control-source');select.tabIndex=-1;select.setAttribute('aria-hidden','true');if(label)label.htmlFor=trigger.id;
  const {popup,isOpen,close,place}=popupFor(trigger,'select-picker','listbox',name);let active=-1,typed='',typedAt=0;
  const enabled=()=>[...select.options].map((option,index)=>({option,index})).filter(x=>!x.option.disabled&&!x.option.hidden);
  function focusOption(index){active=index;for(const node of popup.children)node.classList.toggle('is-active',Number(node.dataset.index)===index);const node=popup.querySelector(`[data-index="${index}"]`);if(node){trigger.setAttribute('aria-activedescendant',node.id);if(node.offsetTop<popup.scrollTop+6)popup.scrollTop=Math.max(0,node.offsetTop-6);else if(node.offsetTop+node.offsetHeight>popup.scrollTop+popup.clientHeight-6)popup.scrollTop=node.offsetTop+node.offsetHeight-popup.clientHeight+6;}}
  function commit(){const option=select.options[active];if(!option||option.disabled||option.hidden)return;select.value=option.value;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));sync();close();trigger.focus({preventScroll:true});}
  function render(){popup.replaceChildren();for(const [index,option]of [...select.options].entries()){
    if(option.hidden)continue;const row=element('div','select-option',option.textContent);row.id=popup.id+'-'+index;row.dataset.index=index;row.setAttribute('role','option');row.setAttribute('aria-selected',String(option.selected));row.setAttribute('aria-disabled',String(option.disabled));
    row.addEventListener('pointerdown',event=>event.preventDefault());row.addEventListener('click',()=>{if(option.disabled)return;active=index;commit();});popup.append(row);
  }focusOption(select.selectedIndex>=0&&!select.options[select.selectedIndex]?.disabled?select.selectedIndex:(enabled()[0]?.index??-1));}
  function sync(){value.textContent=select.selectedOptions[0]?.textContent||'选择分组';trigger.disabled=select.disabled||!enabled().length;trigger.setAttribute('aria-invalid',select.getAttribute('aria-invalid')||'false');for(const attribute of ['aria-errormessage','aria-describedby']){if(select.hasAttribute(attribute))trigger.setAttribute(attribute,select.getAttribute(attribute));else trigger.removeAttribute(attribute);}if(trigger.disabled)close();if(isOpen())render();}
  function open(){sync();if(trigger.disabled)return;if(!isOpen())popup.showPopover();}
  popup.addEventListener('beforetoggle',event=>{if(event.newState==='open'){render();requestAnimationFrame(()=>{if(isOpen())focusOption(active);});}});
  trigger.addEventListener('keydown',event=>{
    if(event.isComposing)return;const key=event.key,options=enabled(),position=options.findIndex(x=>x.index===active);
    if(key==='Escape'&&isOpen()){event.preventDefault();event.stopPropagation();close();return;}
    if(key==='Tab'&&isOpen()){commit();return;}
    if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(key)){
      event.preventDefault();if(!isOpen()){open();if(key==='Home')focusOption(options[0]?.index);if(key==='End')focusOption(options.at(-1)?.index);return;}
      if(key==='Enter'||key===' ')commit();else focusOption(options[key==='Home'?0:key==='End'?options.length-1:Math.max(0,Math.min(options.length-1,position+(key==='ArrowDown'?1:-1)))]?.index);return;
    }
    if(key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();const time=performance.now();typed=time-typedAt>750?key:typed+key;typedAt=time;open();const match=options.find(x=>x.option.textContent.toLocaleLowerCase().startsWith(typed.toLocaleLowerCase()));if(match)focusOption(match.index);}
  });
  select.addEventListener('change',sync);select.addEventListener('focus',()=>trigger.focus());
  new MutationObserver(sync).observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','selected','hidden','aria-invalid','aria-errormessage','aria-describedby']});
  document.addEventListener('kb:controls-sync',sync);sync();return {sync,close,place};
}
function enhanceDate(input){
  input.type='text';input.placeholder='YYYY-MM-DD';input.maxLength=10;input.inputMode='numeric';input.autocomplete='off';input.pattern='[0-9]{4}-[0-9]{2}-[0-9]{2}';
  const hint=element('span','control-hint','日期格式 YYYY-MM-DD，也可打开日历选择；方向键移动日期，PageUp 和 PageDown 切换月份。');hint.id=input.id+'-hint';input.setAttribute('aria-describedby',hint.id);
  const wrap=element('span','date-control'),trigger=button('date-trigger','','打开日期选择器');trigger.id=input.id+'-calendar';trigger.setAttribute('aria-haspopup','dialog');trigger.append(element('span','calendar-icon'));trigger.firstChild.setAttribute('aria-hidden','true');input.before(wrap);wrap.append(input,trigger);wrap.after(hint);
  const {popup,isOpen,close}=popupFor(trigger,'date-picker','dialog','选择截止日期');let cursor=today();
  const header=element('div','calendar-header'),previous=button('calendar-nav','‹','上个月'),next=button('calendar-nav','›','下个月'),title=element('strong','calendar-title');title.id=popup.id+'-title';title.setAttribute('aria-live','polite');popup.setAttribute('aria-labelledby',title.id);header.append(previous,title,next);
  const grid=element('div','calendar-grid');grid.setAttribute('role','grid');grid.setAttribute('aria-labelledby',title.id);
  const weekdays=element('div','calendar-weekdays');weekdays.setAttribute('aria-hidden','true');for(const day of ['一','二','三','四','五','六','日'])weekdays.append(element('span','',day));
  const footer=element('div','calendar-footer'),clear=button('text-button','清除日期'),current=button('secondary','今天');footer.append(clear,current);popup.append(header,weekdays,grid,footer);
  const validate=()=>input.setCustomValidity(input.value&&!parseDay(input.value)?'请输入有效日期，格式为 YYYY-MM-DD':'');
  function select(value){input.value=value;validate();input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));close();trigger.focus({preventScroll:true});}
  function render(focus=false){
    const date=parseDay(cursor);title.textContent=`${date.getUTCFullYear()} 年 ${date.getUTCMonth()+1} 月`;previous.disabled=!moveDay(cursor,0,-1);next.disabled=!moveDay(cursor,0,1);grid.replaceChildren();
    let row;for(const [index,cell]of calendarDays(cursor).entries()){
      if(index%7===0){row=element('div','calendar-week');row.setAttribute('role','row');grid.append(row);}
      const container=element('span','calendar-cell');container.setAttribute('role','gridcell');container.setAttribute('aria-selected',String(cell.value===input.value));
      const day=button('calendar-day'+(cell.inMonth?'':' outside-month'),String(cell.day),cell.value);day.dataset.date=cell.value;day.tabIndex=cell.value===cursor?0:-1;day.disabled=!cell.valid;if(cell.value===today())day.setAttribute('aria-current','date');if(cell.value===input.value)day.classList.add('is-selected');day.addEventListener('click',()=>select(cell.value));container.append(day);row.append(container);
    }
    if(focus)grid.querySelector(`[data-date="${cursor}"]`)?.focus({preventScroll:true});
  }
  previous.addEventListener('click',()=>{cursor=moveDay(cursor,0,-1)||cursor;render();});next.addEventListener('click',()=>{cursor=moveDay(cursor,0,1)||cursor;render();});current.addEventListener('click',()=>select(today()));clear.addEventListener('click',()=>select(''));
  grid.addEventListener('keydown',event=>{
    const shifts={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};let target;
    if(Object.hasOwn(shifts,event.key))target=moveDay(cursor,shifts[event.key]);else if(event.key==='Home'||event.key==='End'){const offset=(parseDay(cursor).getUTCDay()+6)%7;target=moveDay(cursor,event.key==='Home'?-offset:6-offset);}else if(event.key==='PageUp'||event.key==='PageDown')target=moveDay(cursor,0,(event.key==='PageUp'?-1:1)*(event.shiftKey?12:1));else return;
    event.preventDefault();if(target){cursor=target;render(true);}
  });
  popup.addEventListener('beforetoggle',event=>{if(event.newState==='open'){cursor=parseDay(input.value)?input.value:today();render();requestAnimationFrame(()=>{if(isOpen())grid.querySelector(`[data-date="${cursor}"]`)?.focus({preventScroll:true});});}});
  popup.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();trigger.focus({preventScroll:true});}});
  popup.addEventListener('focusout',event=>{if(isOpen()&&event.relatedTarget&&!popup.contains(event.relatedTarget)&&event.relatedTarget!==trigger)close();});
  input.addEventListener('input',validate);input.addEventListener('keydown',event=>{if(event.altKey&&event.key==='ArrowDown'){event.preventDefault();popup.showPopover();}});document.addEventListener('kb:controls-sync',validate);
  new MutationObserver(()=>{trigger.disabled=input.disabled;if(input.disabled)close();}).observe(input,{attributes:true,attributeFilter:['disabled']});
}
export function initControls(){
  document.querySelectorAll('select').forEach(enhanceSelect);document.querySelectorAll('input[type="date"]').forEach(enhanceDate);
  document.querySelectorAll('input[type="range"]').forEach(input=>{paintRange(input);input.addEventListener('input',()=>paintRange(input));});
}
