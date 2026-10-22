import {showDialog} from './ui.mjs';
const $=id=>document.getElementById(id);
const date=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'尚无记录';
export async function initBackups({send,toast,getConnection}){
  let busy=false,preview=null,selected=null,generation=0;
  function error(e){$('cloud-backup-error').textContent=e?.message||'';$('cloud-backup-error').hidden=!e;}
  function controls(disabled){$('cloud-backup-section').querySelectorAll('button,input').forEach(n=>n.disabled=disabled);}
  async function status(){try{const s=await send({type:'backup.status'});if(document.activeElement!==$('backup-device-name'))$('backup-device-name').value=s.deviceName;$('backup-enabled').checked=s.enabled;
    $('cloud-backup-status').textContent=!s.connected?'尚未连接 NAS · 本机数据会保留':s.error?'等待补传 · '+s.error.message:s.pendingChanges?'有更改待备份 · 约 30 秒后上传':s.last?'已保存到 NAS · '+date(s.last.savedAt):'等待首次备份';
    $('backup-device-id').textContent='当前设备：'+s.deviceId.slice(0,8);$('backup-undo').hidden=!s.localUndo;
  }catch(e){error(e);}}
  async function run(fn){if(busy)return;busy=true;controls(true);error(null);try{await fn();}catch(e){error(e);}finally{busy=false;controls(false);await status();}}
  $('backup-config-form').addEventListener('submit',event=>{event.preventDefault();void run(async()=>{await send({type:'backup.configure',deviceName:$('backup-device-name').value,enabled:$('backup-enabled').checked});toast('备份设置已保存');});});
  $('backup-now').addEventListener('click',()=>{void run(async()=>{await send({type:'backup.now'});toast('当前数据已备份到 NAS，Git 推送状态请查看知识库侧栏');});});
  $('backup-list-button').addEventListener('click',()=>{void run(async()=>{
    const c=getConnection();const response=await send({type:'backup.list',revision:c.revision});const list=$('cloud-backup-list');list.replaceChildren();
    if(!response.backups.length){const empty=document.createElement('p');empty.className='field-help';empty.textContent='还没有备份。可以先点击“立即备份”。';list.append(empty);}
    for(const item of response.backups){const row=document.createElement('div');row.className='backup-row';const body=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('p'),button=document.createElement('button');name.textContent=item.device_name+' · '+item.device_id.slice(0,8);detail.textContent=date(item.saved_at)+` · ${item.groups} 个分组 / ${item.bookmarks} 个网站`;detail.className='field-help';body.append(name,detail);button.type='button';button.className='secondary';button.textContent='预览恢复';button.addEventListener('click',()=>{void run(async()=>{selected={deviceId:item.device_id,backupId:item.backup_id,revision:c.revision};preview=await send({type:'backup.preview',...selected});if(!$('settings-dialog').open)return;$('restore-summary').textContent=`${preview.backup.name} · ${date(preview.backup.savedAt)}，包含 ${preview.backup.groups} 个分组、${preview.backup.bookmarks} 个网站及外观设置。恢复将替换当前浏览器的收藏、分组和设置。`;$('restore-error').hidden=true;controls(false);button.focus();showDialog('restore-dialog','backup-list-button');});});row.append(body,button);list.append(row);}
    if(response.invalid_files){const hint=document.createElement('p');hint.className='field-help';hint.textContent=`有 ${response.invalid_files} 个无效备份被跳过，请在 NAS 检查。`;list.append(hint);}
  });});
  const dialog=$('restore-dialog');dialog.kbCanDismiss=()=>!busy;dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('close',()=>{++generation;preview=null;selected=null;});
  $('restore-confirm').addEventListener('click',async()=>{
    if(busy||!preview||!selected)return;const current=++generation;busy=true;$('restore-confirm').disabled=true;
    try{await send({type:'backup.restore',...selected,navigationRevision:preview.navigationRevision,appearanceRevision:preview.appearanceRevision,confirm:true});if(current!==generation)return;dialog.close();toast('已恢复，恢复前的本机数据可在设置中撤销');}
    catch(e){$('restore-error').textContent=e.message;$('restore-error').hidden=false;}
    finally{busy=false;$('restore-confirm').disabled=false;await status();}
  });
  $('backup-undo').addEventListener('click',()=>{void run(async()=>{const nav=await send({type:'navigation.get'}),app=await send({type:'appearance.get'});await send({type:'backup.undo',navigationRevision:nav.revision,appearanceRevision:app.revision});toast('已撤销恢复，原数据已还原');});});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.backup||changes.backupUndo||changes.connection||changes.navigation||changes.appearance))void status();});
  $('settings-dialog').addEventListener('close',()=>{$('cloud-backup-list').replaceChildren();});
  await status();
}
