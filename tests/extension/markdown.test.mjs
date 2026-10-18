import test from 'node:test';
import assert from 'node:assert/strict';
import {articleLink,headingSlug,markdownBody,parseMarkdown} from '../../extensions/chrome-kb/markdown.mjs';
test('front matter stays out of the article while ordinary horizontal rules and code stay intact',()=>{
  assert.equal(markdownBody('---\ntitle: 示例\ntags: [a]\n---\n## 正文'),'## 正文');
  assert.equal(markdownBody('\uFEFF---\r\ntitle: 示例\r\n...\r\n正文'),'正文');
  assert.equal(markdownBody('---\n普通文字\n---\n正文'),'---\n普通文字\n---\n正文');
  assert.equal(markdownBody('---\ntitle: unfinished'),'---\ntitle: unfinished');
});
test('the local parser supports headings, tables, code, lists and blockquotes without HTML execution tokens',()=>{
  const tokens=parseMarkdown('## 标题\n\n> 引用\n\n- 项目\n\n```js\nalert(1)\n```\n\n| a | b |\n| --- | --- |\n| c | d |\n\n<script>alert(1)</script>');
  for(const type of ['heading_open','blockquote_open','bullet_list_open','fence','table_open'])assert.ok(tokens.some(t=>t.type===type));
  const all=tokens.flatMap(t=>[t,...(t.children||[])]);assert.ok(!all.some(t=>t.type.startsWith('html_')));assert.ok(all.some(t=>t.content.includes('<script>')));
});
test('article links reject executable URLs, credentials, encoded schemes and traversal above the vault',()=>{
  for(const value of ['javascript:alert(1)','data:text/html,a','file:///root/a.md','https://user:secret@example.com','//evil.test/a','/etc/a.md','../../secret.md','%2e%2e/%2e%2e/secret.md','%2F%2Fevil.test/a.md','notes\\a.md','java\nscript:alert(1)','https://good.test\u0000.evil'])assert.equal(articleLink(value,'notes/current.md'),null,value);
  assert.deepEqual(articleLink('https://example.com/a?q=1','notes/a.md'),{kind:'external',href:'https://example.com/a?q=1'});
});
test('relative Markdown links remain inside the vault and fragments never become script URLs',()=>{
  assert.deepEqual(articleLink('../projects/项目.md','notes/a.md'),{kind:'document',path:'projects/项目.md'});
  assert.deepEqual(articleLink('%E7%AC%94%E8%AE%B0.md','notes/a.md'),{kind:'document',path:'notes/笔记.md'});
  assert.deepEqual(articleLink('../assets/a.png','notes/a.md'),{kind:'attachment',path:'assets/a.png'});
  assert.deepEqual(articleLink('#My%20Heading','notes/a.md'),{kind:'anchor',id:'kb-h-my-heading'});
  assert.equal(headingSlug('章节：Hello, World!'),'章节hello-world');
});
test('oversized articles fail explicitly before parsing and stored content is never changed',()=>{
  const original='x'.repeat(1000001);assert.throws(()=>parseMarkdown(original),/文章较长/);assert.equal(original.length,1000001);
});

test('the matching leading article title is not duplicated, while other headings are preserved',()=>{
  assert.equal(parseMarkdown('# 同名标题\n\n## 内容',{title:'同名标题'})[0].tag,'h2');
  assert.equal(parseMarkdown('# 不同标题\n\n正文',{title:'文章名称'})[0].tag,'h1');
});
