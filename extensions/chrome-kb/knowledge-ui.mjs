import {preserveFocus,showDialog,showFormError} from './ui.mjs';
import {markdownBody,renderMarkdown} from './markdown.mjs';
const $=id=>document.getElementById(id);
const node=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
export function initKnowledge({send,getConnection}) {
  let listGeneration=0,readGeneration=0,connectionRevision=null,loaded=false,active=false,currentRecord=null,loadingList=false;
  function clearReader(){++readGeneration;currentRecord=null;$('document-content').replaceChildren();$('document-title').textContent='文章阅读';$('document-path').textContent='';$('document-meta').textContent='';$('document-loading').hidden=true;showFormError('document-error',null);$('document-retry').hidden=true;}
  function clear(){++listGeneration;loaded=false;loadingList=false;$('knowledge-search-button').disabled=false;$('knowledge-reload').disabled=false;$('document-list').replaceChildren();if($('document-dialog').open)$('document-dialog').close();clearReader();$('knowledge-query').value='';$('knowledge-message').textContent='连接 NAS 后查看最近文档';showFormError('knowledge-error',null);}
  function connectionChanged(){const c=getConnection();if(c.revision!==connectionRevision){clear();connectionRevision=c.revision;if(active&&c.configured)void load();}}
  async function load() {
    const c=getConnection(),ticket=++listGeneration,query=$('knowledge-query').value.trim();
    if(!c.configured){$('knowledge-message').textContent='先在设置中连接 NAS，再查看知识库';return;}
    loadingList=true;$('knowledge-search-button').disabled=true;$('knowledge-reload').disabled=true;$('document-list').setAttribute('aria-busy','true');
    $('knowledge-message').textContent='正在读取…';showFormError('knowledge-error',null);
    try {
      const response=await send({type:'knowledge.list',revision:c.revision,query});if(ticket!==listGeneration||getConnection().revision!==c.revision)return;
      const records=query?response.results:response.records;loaded=true;
      $('knowledge-message').textContent=query?`找到 ${records.length} 条结果${response.pending_files?.length?' · 索引待更新':''}`:`最近更新 · ${records.length} 篇`;
      if(!records.length)$('knowledge-message').textContent=query?'没有找到匹配内容，试试其他关键词':'知识库暂时没有文档';
      const restore=preserveFocus($('document-list'));$('document-list').replaceChildren();
      for(const record of records){
        if(typeof record.path!=='string')continue;
        const item=node('li',''),b=node('button','document-button'),icon=node('span','document-icon','▤'),copy=node('span','document-copy'),arrow=node('span','document-arrow','↗');b.type='button';b.dataset.focusKey='doc:'+record.path;b.setAttribute('aria-label','阅读文章：'+(record.title||record.path));icon.setAttribute('aria-hidden','true');arrow.setAttribute('aria-hidden','true');
        copy.append(node('strong','',record.title||record.path),node('small','',record.path));if(record.snippet)copy.append(node('span','document-excerpt',record.snippet.slice(0,220)));if(record.stale)copy.append(node('small','document-stale','索引待更新 · 阅读当前文件'));
        b.append(icon,copy,arrow);b.addEventListener('click',()=>void read(record));item.append(b);$('document-list').append(item);
      }restore();
    }catch(e){if(ticket!==listGeneration)return;$('knowledge-message').textContent='未能读取最新知识';showFormError('knowledge-error',e);}
    finally{if(ticket===listGeneration){loadingList=false;$('knowledge-search-button').disabled=false;$('knowledge-reload').disabled=false;$('document-list').removeAttribute('aria-busy');}}
  }
  async function read(record) {
    const c=getConnection(),ticket=++readGeneration;currentRecord=record;
    $('document-content').replaceChildren();$('document-title').textContent=record.title||record.path;$('document-path').textContent=record.path;$('document-meta').textContent='';$('document-loading').hidden=false;$('document-retry').hidden=true;showFormError('document-error',null);
    if(!$('document-dialog').open)showDialog('document-dialog','knowledge-reload');
    $('document-scroll').scrollTop=0;
    try {
      const result=await send({type:'knowledge.read',revision:c.revision,path:record.path});if(ticket!==readGeneration||getConnection().revision!==c.revision||!$('document-dialog').open)return;
      $('document-title').textContent=result.metadata?.title||record.title||record.path;$('document-path').textContent=result.path;
      $('document-content').replaceChildren(renderMarkdown(result.content,{path:result.path,title:$('document-title').textContent}));
      const length=markdownBody(result.content).replace(/\s/g,'').length;$('document-meta').textContent=`约 ${length.toLocaleString('zh-CN')} 字 · ${Math.max(1,Math.ceil(length/500))} 分钟阅读`;
      const tags=result.metadata?.tags;if(Array.isArray(tags))for(const tag of tags.slice(0,6))$('document-meta').append(node('span','article-tag',String(tag)));
    }catch(e){if(ticket===readGeneration){showFormError('document-error',e);$('document-retry').hidden=false;}}
    finally{if(ticket===readGeneration)$('document-loading').hidden=true;}
  }
  $('document-dialog').addEventListener('close',clearReader);
  $('document-retry').addEventListener('click',()=>{if(currentRecord)void read(currentRecord);});
  $('document-content').addEventListener('click',event=>{const internal=event.target.closest('[data-document-path]');if(internal){void read({path:internal.dataset.documentPath,title:internal.textContent});return;}const anchor=event.target.closest('[data-article-anchor]');if(anchor){event.preventDefault();document.getElementById(anchor.dataset.articleAnchor)?.scrollIntoView({block:'start'});}});
  $('knowledge-search-form').addEventListener('submit',e=>{e.preventDefault();if(!loadingList)void load();});$('knowledge-reload').addEventListener('click',()=>void load());
  return {connectionChanged,activate(){connectionChanged();active=true;if(!loaded&&!loadingList)void load();},deactivate(){active=false;}};
}
