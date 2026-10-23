import {animateContent,requestDialogClose} from './motion-ui.mjs';
const $=id=>document.getElementById(id);
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const KEY='workbenchInterface';
const interfacePreferences=value=>({colorScheme:value?.colorScheme==='light'?'light':'dark',reducedMotion:value?.reducedMotion===true,readerSize:[15,16,18].includes(value?.readerSize)?value.readerSize:16,textGlow:value?.textGlow===true,wallpaperBars:value?.wallpaperBars!==false,collectionAlignment:value?.collectionAlignment==='left'?'left':'center'});
export async function initWorkbench(){
  let prefs=interfacePreferences();
  try{prefs=interfacePreferences((await chrome.storage.local.get(KEY))[KEY]);}catch{/* A storage read failure keeps safe visual defaults. */}
  const apply=()=>{document.documentElement.dataset.collectionAlignment=prefs.collectionAlignment;document.documentElement.dataset.colorScheme=prefs.colorScheme;document.documentElement.dataset.motion=prefs.reducedMotion?'reduce':'normal';document.documentElement.dataset.textGlow=prefs.textGlow?'on':'off';document.documentElement.dataset.wallpaperBars=prefs.wallpaperBars?'on':'off';document.documentElement.style.setProperty('--reader-size',prefs.readerSize+'px');document.querySelector('meta[name="color-scheme"]').content=prefs.colorScheme;try{localStorage.setItem('kb-first-paint-scheme',prefs.colorScheme);}catch{/* First-paint cache is optional; chrome.storage remains authoritative. */}};
  const save=async changes=>{const previous={...prefs};Object.assign(prefs,changes);apply();try{await chrome.storage.local.set({[KEY]:prefs});}catch{prefs=previous;apply();$('toast').className='toast error';$('toast').textContent='界面偏好未保存，请检查浏览器存储空间';$('toast').hidden=false;}};
  apply();
  const footer=$('show-knowledge-button').closest('footer'),enable=$('show-knowledge-button'),count=$('site-total'),workspace=$('workspace-pill');
  footer.className='workbench-statusbar';footer.setAttribute('aria-label','工作台信息状态栏');
  const left=node('div','status-left'),activity=node('div','status-activity'),right=node('div','status-right');
  activity.id='workbench-activity';activity.setAttribute('role','status');activity.setAttribute('aria-live','polite');activity.textContent='本机收藏已就绪';
  left.append(count,workspace);right.append(enable);footer.replaceChildren(left,activity,right);document.body.append(footer);
  const toast=$('toast');right.append(toast);toast.className='status-toast';
  const connection=document.querySelector('.connection-line');connection.classList.add('status-connection');right.prepend(connection);right.append($('last-refresh'));
  const header=document.querySelector('.home-actions'),knowledge=$('knowledge-toggle');header.prepend(knowledge);document.querySelector('.knowledge-dock').remove();
  knowledge.lastElementChild.remove();
  const theme=node('button','glass-icon','◐');theme.id='color-scheme-toggle';theme.type='button';theme.setAttribute('aria-label','切换深浅配色');header.prepend(theme);
  theme.onclick=()=>void save({colorScheme:prefs.colorScheme==='dark'?'light':'dark'});
  document.querySelector('.local-indicator').remove();document.querySelector('.brand-caption').textContent='我的工作台';
  const caption=document.querySelector('.collection-summary>div:first-child');caption.replaceChildren(node('h1','','全部收藏'),node('p','collection-caption','按分组安放，每次打开都从容一点。'));
  // Reuse every original settings section and input; business listeners and
  // validation retain their IDs, forms, revisions and permission boundaries.
  const dialog=$('settings-dialog'),heading=dialog.querySelector('.dialog-heading'),sections=[...dialog.querySelectorAll(':scope > .settings-section')],oldFooter=dialog.querySelector('.drawer-footer');
  const pages=node('div','settings-pages'),nav=node('nav','settings-navigation'),frame=node('div','settings-frame');nav.setAttribute('aria-label','设置分类');nav.setAttribute('role','tablist');
  const definitions=[['appearance','外观与背景'],['motion','动效体验'],['browsing','搜索与浏览'],['data','收藏管理'],['sync','备份与同步'],['connection','NAS 连接']],panels={};
  let selected='appearance';
  function select(id,animate=true){selected=id;for(const [name]of definitions){panels[name].hidden=name!==id;const b=$('settings-nav-'+name);b.setAttribute('aria-selected',String(name===id));b.tabIndex=name===id?0:-1;}pages.scrollTop=0;if(animate)animateContent(panels[id]);}
  for(const [id,title]of definitions){const b=node('button','',title);b.type='button';b.id='settings-nav-'+id;b.dataset.settingsTab=id;b.setAttribute('role','tab');b.setAttribute('aria-controls','settings-page-'+id);b.onclick=()=>select(id);nav.append(b);const page=node('div','settings-page');page.id='settings-page-'+id;page.setAttribute('role','tabpanel');page.setAttribute('aria-labelledby',b.id);panels[id]=page;pages.append(page);}
  frame.append(nav,pages);dialog.append(frame);
  panels.appearance.append(sections[0]);panels.browsing.append(sections[1]);panels.data.append(sections[2]);panels.sync.append(sections[3],sections[4]);panels.connection.append(sections[5]);
  const browsing=sections[1];browsing.prepend($('appearance-engine'));browsing.append($('pref-clock').closest('label'));sections[0].querySelector('h3').textContent='外观与背景';
  const scheme=node('fieldset','choice-field'),legend=node('legend','','界面配色');scheme.append(legend);const choices=node('div','theme-options');for(const [value,title]of [['dark','深色'],['light','浅色']]){const b=node('button','',title);b.type='button';b.dataset.colorScheme=value;b.setAttribute('aria-pressed',String(prefs.colorScheme===value));b.onclick=async()=>{await save({colorScheme:value});syncInterface();};choices.append(b);}scheme.append(choices);sections[0].prepend(scheme);
  const appearanceToggles={};let appearanceAnchor=scheme;
  for(const [key,id,title,description]of [['textGlow','pref-text-glow','文字高光','为时钟、收藏名称等浮动文字增加光晕；复杂壁纸下可按需开启。'],['wallpaperBars','pref-wallpaper-bars','顶底栏融入壁纸','去掉整条顶栏、底栏的底色和分隔线，信息位置保持固定。']]){
    const label=node('label','toggle-row'),copy=node('span','',title),control=node('input');copy.append(node('small','',description));control.id=id;control.type='checkbox';control.setAttribute('role','switch');control.checked=prefs[key];label.htmlFor=id;label.append(copy,control);appearanceAnchor.after(label);appearanceAnchor=label;appearanceToggles[key]=control;control.onchange=async()=>{await save({[key]:control.checked});syncInterface();};
  }

  const alignment=node('fieldset','choice-field');alignment.id='collection-alignment';alignment.append(node('legend','','收藏对齐方式'));
  const alignmentChoices=node('div','theme-options');
  for(const [value,title]of [['center','居中'],['left','靠左']]){
    const b=node('button','',title);b.type='button';b.dataset.collectionAlignment=value;b.setAttribute('aria-pressed',String(prefs.collectionAlignment===value));b.onclick=async()=>{await save({collectionAlignment:value});syncInterface();};alignmentChoices.append(b);
  }
  alignment.append(alignmentChoices,node('p','field-help','统一调整首页文件夹内容和分组内网站的排列方向；紧凑布局仍独立控制。'));appearanceAnchor.after(alignment);

  const motion=node('section','settings-section');motion.append(node('h3','','轻盈弹簧'),node('p','dialog-copy','短距离轻抬，轻微弹簧缓冲。退出时保持文字与窗口尺寸。'));
  const reduce=node('label','toggle-row'),copy=node('span','','减少动态效果'),small=node('small','','系统偏好始终优先；开启后取消位移。'),input=node('input');input.id='pref-reduced-motion';input.type='checkbox';input.setAttribute('role','switch');input.checked=prefs.reducedMotion;copy.append(small);reduce.htmlFor=input.id;reduce.append(copy,input);input.onchange=async()=>{await save({reducedMotion:input.checked});syncInterface();};motion.append(reduce,node('p','field-help','界面配色、动效和阅读字号保存在此设备。原有收藏、背景、备份与同步配置全部保留。'));panels.motion.append(motion);
  const audit=node('button','secondary','检查网站可用性');audit.type='button';audit.onclick=()=>$('audit-sites-button').click();sections[2].prepend(audit);
  frame.append(nav,pages);const done=node('div','settings-bottom'),doneButton=node('button','primary','完成');doneButton.type='button';doneButton.onclick=()=>requestDialogClose(dialog);done.append(node('span','field-help','修改即时保存，备份与连接操作需单独确认'),doneButton);dialog.replaceChildren(heading,frame,done);if(oldFooter){oldFooter.textContent='KB 工作台 0.15.10';panels.connection.append(oldFooter);}
  const selectConnection=()=>select('connection',false);$('knowledge-settings').addEventListener('click',selectConnection);$('empty-action').addEventListener('click',()=>{if($('empty-action').textContent==='连接知识库')selectConnection();});
  workspace.addEventListener('click',()=>select('sync',false));
  // Existing workspace handler invokes settings-button before scrolling; retain
  // the current section on open so deep links reach visible controls.
  $('settings-button').addEventListener('click',()=>select(selected,false));
  const watchErrors=new MutationObserver(entries=>{for(const entry of entries){const error=entry.target.nodeType===1?entry.target:entry.target.parentElement;if(error?.matches('.form-error:not([hidden])')){const page=error.closest('.settings-page');if(page&&dialog.open)select(page.id.replace('settings-page-',''));}}});
  watchErrors.observe(pages,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});
  nav.onkeydown=e=>{if(!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const ids=definitions.map(x=>x[0]),index=ids.indexOf(selected),next=e.key==='Home'?0:e.key==='End'?ids.length-1:(index+(['ArrowDown','ArrowRight'].includes(e.key)?1:-1)+ids.length)%ids.length;select(ids[next]);$('settings-nav-'+ids[next]).focus();};select('appearance',false);
  function syncInterface(){apply();dialog.querySelectorAll('[data-collection-alignment]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.collectionAlignment===prefs.collectionAlignment)));input.checked=prefs.reducedMotion;for(const [key,control]of Object.entries(appearanceToggles))control.checked=prefs[key];document.querySelectorAll('.reader-size[data-size]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.size)===prefs.readerSize)));dialog.querySelectorAll('[data-color-scheme]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.colorScheme===prefs.colorScheme)));}
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[KEY]){const value=changes[KEY].newValue;prefs=interfacePreferences(value);syncInterface();}});
  // Fixed controls; only results scroll in tasks and knowledge tabs.
  const taskPanel=document.querySelector('.task-panel');taskPanel.querySelector('.section-heading').after($('filters'));
  const results=node('div','task-results');results.append($('task-list'),$('empty'));taskPanel.querySelector('.list-footer').before(results);
  const knowledgeResults=node('div','knowledge-results');knowledgeResults.append($('knowledge-error'),$('document-list'));$('knowledge-view').append(knowledgeResults);
  const activitySources=['icon-batch-status','audit-progress-text','workspace-status','cloud-backup-status','banner'];
  function updateActivity(){if(!$('toast').hidden){activity.textContent=$('toast').textContent;activity.classList.toggle('status-error',$('toast').classList.contains('error'));return;}activity.classList.remove('status-error');const running=activitySources.map(id=>$(id)?.textContent?.trim()).find(text=>text&&/正在|进行中/.test(text)&&!/正在读取备份状态/.test(text));activity.textContent=running||(!$('banner').hidden?$('banner').textContent:'本机收藏已就绪');}
  const observer=new MutationObserver(updateActivity);for(const id of [...activitySources,'toast'])observer.observe($(id),{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class']});updateActivity();
  $('knowledge-panel').addEventListener('click',event=>{if(event.target.closest('.knowledge-tabs button')){animateContent(document.querySelector('.drawer-content'));}});
  // Reader controls: local display preferences only, never article mutations.
  const tools=node('div','reader-tools');for(const [size,label]of [[15,'小'],[16,'中'],[18,'大']]){const b=node('button','reader-size',label);b.type='button';b.dataset.size=String(size);b.setAttribute('aria-label','阅读字号'+label);b.setAttribute('aria-pressed',String(prefs.readerSize===size));b.onclick=async()=>{await save({readerSize:size});syncInterface();};tools.append(b);}
  document.querySelector('.article-toolbar>div').prepend(tools);
  const articleFrame=node('div','article-frame'),toc=node('nav','article-outline');toc.id='article-outline';toc.setAttribute('aria-label','文章目录');
  const outline=node('details','reader-outline'),outlineSummary=node('summary','','文章目录'),outlineCount=node('span','outline-count');outline.id='reader-outline';outline.hidden=true;outlineSummary.append(outlineCount);outline.append(outlineSummary,toc);
  const scroller=$('document-scroll');scroller.before(articleFrame);articleFrame.append(scroller);document.querySelector('.article-header').after(outline);
  const progress=node('div','reader-progress');progress.id='reader-progress';progress.setAttribute('aria-hidden','true');$('document-dialog').append(progress);
  const updateProgress=()=>{const max=scroller.scrollHeight-scroller.clientHeight;progress.style.setProperty('--read-progress',max>0?Math.max(0,Math.min(1,scroller.scrollTop/max)):0);};scroller.addEventListener('scroll',updateProgress,{passive:true});
  new ResizeObserver(updateProgress).observe(scroller);
  new MutationObserver(()=>{
    toc.replaceChildren();outline.open=false;
    const headings=[...$('document-content').querySelectorAll('h2,h3')];
    outlineCount.textContent=`${headings.length} 节`;outline.hidden=headings.length===0;
    for(const [index,heading]of headings.entries()){
      if(!heading.id)heading.id='reader-section-'+index;
      const b=node('button',heading.tagName==='H3'?'outline-sub':'',heading.textContent);b.type='button';
      b.onclick=()=>{outline.open=false;heading.tabIndex=-1;heading.focus();heading.scrollIntoView({block:'start',behavior:'instant'});toc.querySelectorAll('button').forEach(n=>n.removeAttribute('aria-current'));b.setAttribute('aria-current','location');};toc.append(b);
    }
    updateProgress();
  }).observe($('document-content'),{childList:true});
  outline.addEventListener('toggle',updateProgress);
  const reader=$('document-dialog'),expand=$('reader-expand');
  function setExpanded(expanded){
    if(reader.hasAttribute('data-kb-closing'))return;
    const top=scroller.getBoundingClientRect().top,previous=scroller.scrollTop;
    const anchor=previous>0?[...$('document-content').querySelectorAll('h2,h3,p,li,pre,table')].find(el=>{const r=el.getBoundingClientRect();return r.bottom>top+24&&r.top<top+scroller.clientHeight;}):null;
    const offset=anchor?anchor.getBoundingClientRect().top-top:0;
    reader.classList.toggle('reader-expanded',expanded);
    expand.setAttribute('aria-pressed',String(expanded));
    expand.title=expanded?'恢复阅读窗口':'全屏阅读';expand.setAttribute('aria-label',expand.title);
    expand.querySelector('path').setAttribute('d',expanded?'M3 8h5V3m13 5h-5V3M8 21v-5H3m13 5v-5h5':'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5');
    scroller.scrollTop=anchor?scroller.scrollTop+anchor.getBoundingClientRect().top-scroller.getBoundingClientRect().top-offset:previous;
    updateProgress();
  }
  expand.addEventListener('click',()=>setExpanded(!reader.classList.contains('reader-expanded')));
  reader.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!event.defaultPrevented&&reader.classList.contains('reader-expanded')){
      event.preventDefault();event.stopImmediatePropagation();setExpanded(false);expand.focus();
    }
  });
  reader.addEventListener('close',()=>setExpanded(false));

}
