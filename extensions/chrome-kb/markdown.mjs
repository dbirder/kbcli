import MarkdownIt from './vendor/markdown-it-15.0.3.mjs';
const parser = new MarkdownIt({html:false,linkify:false,typographer:false,breaks:false});
const tags = new Set(['p','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','strong','em','s','table','thead','tbody','tr','th','td']);
export function markdownBody(source) {
  const text=String(source||'').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  const front=/^---\n([\s\S]*?)\n(?:---|\.\.\.)\s*(?:\n|$)/.exec(text);
  return front&&/^[\w-]+\s*:/m.test(front[1])?text.slice(front[0].length):text;
}
export function parseMarkdown(source,{title=''}={}) {
  const body=markdownBody(source);
  if(body.length>1000000)throw Error('文章较长，暂不支持在标签页渲染，请在电脑端打开原文');
  const tokens=parser.parse(body,{});
  if(title&&tokens[0]?.type==='heading_open'&&tokens[0].tag==='h1'&&tokens[1]?.content.trim()===title.trim())tokens.splice(0,3);
  return tokens;
}
export const headingSlug = value=>String(value).normalize('NFKC').toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu,'').replace(/\s+/g,'-')||'section';
export function articleLink(value,path='') {
  if(typeof value!=='string'||/[\u0000-\u0020\u007f\\]/.test(value)||value.startsWith('//'))return null;
  if(value.startsWith('#')) {try{return {kind:'anchor',id:'kb-h-'+headingSlug(decodeURIComponent(value.slice(1))) };}catch{return null;}}
  if(/^[a-z][a-z\d+.-]*:/i.test(value)) {
    try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?{kind:'external',href:url.href}:null;}catch{return null;}
  }
  if(value.startsWith('/'))return null;
  let relative;try{relative=decodeURIComponent(value.split(/[?#]/)[0]);}catch{return null;}
  if(!relative||/[\u0000-\u001f\\:]/.test(relative)||relative.startsWith('/'))return null;
  const parts=path.split('/').slice(0,-1);
  for(const segment of relative.split('/')) {if(!segment||segment==='.')continue;if(segment==='..'){if(!parts.length)return null;parts.pop();}else parts.push(segment);}
  const target=parts.join('/');return target?{kind:target.endsWith('.md')?'document':'attachment',path:target}:null;
}
// Build only known elements from parser tokens. Source HTML is disabled and no
// knowledge content ever passes through innerHTML, an iframe or executable code.
export function renderMarkdown(source,{document:dom=globalThis.document,path='',title=''}={}) {
  const root=dom.createDocumentFragment(),headings=new Map();
  const make=(tag,cls,text)=>{const n=dom.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  function link(token) {
    const target=articleLink(token.attrGet('href')||'',path);
    if(!target)return make('span','article-link-unavailable');
    if(target.kind==='external'){const a=make('a');a.href=target.href;a.target='_blank';a.rel='noopener noreferrer';return a;}
    if(target.kind==='anchor'){const a=make('a');a.href='#'+target.id;a.dataset.articleAnchor=target.id;return a;}
    if(target.kind==='document'){const b=make('button','article-document-link');b.type='button';b.dataset.documentPath=target.path;return b;}
    return make('span','article-link-unavailable');
  }
  function append(tokens,parent) {
    const stack=[parent];
    for(let index=0;index<tokens.length;index++) {
      const token=tokens[index],current=stack.at(-1);
      if(token.nesting===-1){if(stack.length>1)stack.pop();continue;}
      if(token.nesting===1){
        const element=token.type==='link_open'?link(token):make(tags.has(token.tag)?token.tag:'span');
        if(/^h[1-6]$/.test(token.tag)){const slug=headingSlug(tokens[index+1]?.content||''),count=headings.get(slug)||0;headings.set(slug,count+1);element.id='kb-h-'+slug+(count?'-'+(count+1):'');}
        if(token.tag==='ol'&&/^\d+$/.test(token.attrGet('start')||''))element.setAttribute('start',token.attrGet('start'));
        if(['th','td'].includes(token.tag)){const align=/^text-align:(left|right|center)$/.exec(token.attrGet('style')||'');if(align)element.style.textAlign=align[1];}
        current.append(element);stack.push(element);continue;
      }
      if(token.type==='inline'){append(token.children||[],current);continue;}
      if(token.type==='text'){
        const task=/^\[([ xX])\]\s+/.exec(token.content);
        if(task&&current.tagName==='P'&&current.parentElement?.tagName==='LI'&&!current.childNodes.length){const check=make('input','markdown-checkbox');check.type='checkbox';check.checked=task[1].toLowerCase()==='x';check.disabled=true;check.setAttribute('aria-label',check.checked?'已完成':'未完成');current.append(check,dom.createTextNode(token.content.slice(task[0].length)));}
        else current.append(dom.createTextNode(token.content));
      }else if(token.type==='code_inline')current.append(make('code','',token.content));
      else if(['fence','code_block'].includes(token.type)){const figure=make('figure','article-code'),pre=make('pre'),code=make('code','',token.content);pre.append(code);const language=token.info.trim().split(/\s+/)[0].slice(0,40);if(language)figure.append(make('figcaption','',language));figure.append(pre);current.append(figure);}
      else if(token.type==='softbreak')current.append(dom.createTextNode('\n'));
      else if(token.type==='hardbreak')current.append(make('br'));
      else if(token.type==='hr')current.append(make('hr'));
      else if(token.type==='image'){
        const target=articleLink(token.attrGet('src')||'',path),box=make('span','article-image-placeholder');box.append(make('span','',`图片：${token.content||'未命名图片'}`));
        if(target?.kind==='external'){const a=make('a','','查看图片 ↗');a.href=target.href;a.target='_blank';a.rel='noopener noreferrer';box.append(a);}
        else box.append(make('small','','本地附件暂未接入预览'));current.append(box);
      }else if(token.content)current.append(dom.createTextNode(token.content));
    }
  }
  append(parseMarkdown(source,{title}),root);
  for(const table of root.querySelectorAll('table')){const wrap=make('div','article-table');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','表格，可横向滚动');table.replaceWith(wrap);wrap.append(table);}
  return root;
}
