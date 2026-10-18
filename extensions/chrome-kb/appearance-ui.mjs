import {ENGINES} from './appearance.mjs';
import {showFormError} from './ui.mjs';
const $=id=>document.getElementById(id);
export async function prepareWallpaper(file) {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 15*1024*1024 || !file.size) throw Error('请选择不超过 15 MiB 的 PNG、JPEG 或 WebP 图片');
  const bytes = new Uint8Array(await file.slice(0,12).arrayBuffer());
  const signature = [...bytes].map(x=>String.fromCharCode(x)).join('');
  const valid = file.type === 'image/png' ? signature.startsWith('\x89PNG\r\n\x1a\n') : file.type === 'image/jpeg' ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255 : signature.startsWith('RIFF') && signature.slice(8)==='WEBP';
  if (!valid) throw Error('图片格式与文件内容不符，请重新选择');
  const image = await createImageBitmap(file);
  try {
    if (!image.width || !image.height || image.width*image.height>40000000) throw Error('图片分辨率过大，请选择不超过 4000 万像素的图片');
    const ratio=Math.min(1,2560/Math.max(image.width,image.height)), canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    for (const quality of [0.86,0.7,0.5]) {
      const dataURL=canvas.toDataURL('image/webp',quality);
      if (dataURL.startsWith('data:image/webp;base64,') && dataURL.length<=2*1024*1024) return {name:file.name.slice(0,160),dataURL};
    }
    throw Error('图片压缩后仍过大，请选择较小的背景');
  } finally { image.close(); }
}
export async function initAppearance({send,toast}) {
  let data=null,busy=false,generation=0;
  function render() {
    const root=document.documentElement;
    root.dataset.theme=data.theme;root.style.setProperty('--wallpaper-dim',data.dim/100);root.style.setProperty('--wallpaper-blur',data.blur+'px');
    $('wallpaper-image').src=data.wallpaper?.dataURL || 'assets/mist.svg';$('wallpaper-image').style.objectPosition=data.position;
    $('wallpaper-preview').src=data.wallpaper?.dataURL || 'assets/mist.svg';$('wallpaper-name').textContent=data.wallpaper?.name || '山雾 · 内置背景';
    $('wallpaper-preview').style.objectPosition=data.position;$('wallpaper-preview').style.filter=`brightness(${1-data.dim/100}) blur(${data.blur/3}px)`;
    $('clock').hidden=!data.showClock; $('pref-clock').checked=data.showClock;
    for(const key of ['dim','blur']) $('appearance-'+key).value=data[key];
    for(const key of ['position','engine']) document.querySelectorAll(`input[name="appearance-${key}"]`).forEach(input=>{input.checked=input.value===data[key];});
    $('dim-value').textContent=data.dim+'%';$('blur-value').textContent=data.blur+' px';
    $('web-search-button').textContent=ENGINES[data.engine].name+'搜索 ↗';
    document.querySelectorAll('button[data-theme]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.theme===data.theme)));
  }
  async function load(){ try { data=await send({type:'appearance.get'});render(); } catch(e){showFormError('appearance-error',e);} }
  const controls=()=>document.querySelectorAll('#appearance-section input,#appearance-section select,#appearance-section button');
  async function update(changes,expectedRevision=data?.revision) {
    if(busy||!data)return;const focused=document.activeElement;busy=true;controls().forEach(n=>n.disabled=true);
    try{data=await send({type:'appearance.update',revision:expectedRevision,changes});render();showFormError('appearance-error',null);}
    catch(e){if(e.code==='APPEARANCE_CHANGED')await load();if(data)render();showFormError('appearance-error',e);}
    finally{busy=false;controls().forEach(n=>n.disabled=false);if($('settings-dialog').open&&focused?.isConnected&&!focused.disabled&&['BODY','DIALOG'].includes(document.activeElement.tagName))focused.focus({preventScroll:true});}
  }
  for(const key of ['dim','blur']) $('appearance-'+key).addEventListener('change',e=>void update({[key]:Number(e.target.value)}));
  for(const key of ['position','engine']) document.querySelectorAll(`input[name="appearance-${key}"]`).forEach(input=>input.addEventListener('change',()=>{if(input.checked)void update({[key]:input.value});}));
  for(const key of ['dim','blur']) $('appearance-'+key).addEventListener('input',e=>{$(key+'-value').textContent=e.target.value+(key==='dim'?'%':' px');});
  $('pref-clock').addEventListener('change',e=>void update({showClock:e.target.checked}));
  document.querySelectorAll('button[data-theme]').forEach(b=>b.addEventListener('click',()=>void update({theme:b.dataset.theme})));
  $('reset-wallpaper').addEventListener('click',()=>{++generation;void update({wallpaper:null,theme:'mist',dim:24,blur:0,position:'center'});});
  $('wallpaper-input').addEventListener('change',async e=>{
    const file=e.target.files[0],ticket=++generation,expectedRevision=data?.revision;e.target.value='';if(!file||busy)return;
    // Disable all appearance mutations while decoding, so reset/another upload cannot race it.
    busy=true;controls().forEach(n=>n.disabled=true);showFormError('appearance-error',null);$('wallpaper-name').textContent='正在处理图片…';
    let wallpaper;
    try{wallpaper=await prepareWallpaper(file);}catch(error){showFormError('appearance-error',error);render();}
    finally{busy=false;controls().forEach(n=>n.disabled=false);}
    if(wallpaper&&ticket===generation){await update({wallpaper},expectedRevision);if(data?.wallpaper?.dataURL===wallpaper.dataURL)toast('背景已保存在此浏览器');}
  });
  $('home-search-form').addEventListener('submit',e=>{e.preventDefault();const query=$('site-search').value.trim();if(query&&data)window.open(ENGINES[data.engine].url+encodeURIComponent(query),'_blank','noopener,noreferrer');});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.appearance)void load();});
  await load();
}
