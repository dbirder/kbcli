"""SQLite retrieval experiment using synthetic records, not an end-to-end kbcli benchmark.

Run: python3 research/search_benchmark.py
Uses only the standard library; temporary databases are automatically removed.
The generated tokens are overlapping Han character bigrams plus Latin words.
The corpus is repetitive and cannot establish real-world retrieval quality.
"""
import sqlite3, time, tempfile, pathlib, re, statistics, platform, json

def tokens(text):
    out=[]
    for term in re.findall(r'[\u3400-\u9fff]+|[A-Za-z0-9_]+',text):
        if '\u3400' <= term[0] <= '\u9fff':
            out.extend(term[i:i+2] for i in range(len(term)-1)) if len(term)>1 else out.append(term)
        else:
            out.append(term.lower())
    return ' '.join(out)

def match(text):
    return ' AND '.join('"'+t+'"' for t in dict.fromkeys(tokens(text).split()))

c=sqlite3.connect(':memory:')
c.execute('create virtual table default_fts using fts5(body)')
c.execute("create virtual table trigram_fts using fts5(body,tokenize='trigram')")
c.execute('create virtual table bigram_fts using fts5(body)')
raw='我们需要研究知识库同步冲突处理方案'
c.execute('insert into default_fts values (?)',(raw,))
c.execute('insert into trigram_fts values (?)',(raw,))
c.execute('insert into bigram_fts values (?)',(tokens(raw),))
checks={}
for query in ['同步','同步冲突']:
    checks[query]={}
    for table, q in [('default_fts',query),('trigram_fts',query),('bigram_fts',match(query))]:
        checks[query][table]=c.execute(f'select count(*) from {table} where {table} match ?',(q,)).fetchone()[0]
print(json.dumps({'environment':{'python_sqlite':sqlite3.sqlite_version,'machine':platform.machine(),'os':platform.system()},'chinese_boundary':checks},ensure_ascii=False))
c.close()

topics=['同步冲突','元数据规范','中文检索','文件版本','知识管理','网络协议','数据库事务','代码审查','云端备份','缓存更新','链接修复','任务调度','日志分析','身份认证','资料整理','全文索引','分词策略','部署方案','性能测试','来源追溯']
base='这里记录实践经验和问题处理过程，需要保存原始资料并确认结果。Markdown笔记支持本地编辑和离线访问，Python工具提供查询能力。'
rows=[]
for doc in range(10000):
    topic=topics[doc%len(topics)]
    for chunk in range(5):
        raw=f'第{chunk}节讨论{topic}的具体方案。'+base*3+f'编号doc{doc}。'
        title=f'{topic}说明{doc}'
        rows.append((len(rows)+1,doc,title,raw,tokens(title),tokens(raw)))
with tempfile.TemporaryDirectory(prefix='kbcli-bench-') as d:
    path=pathlib.Path(d)/'index.sqlite3'
    db=sqlite3.connect(path)
    db.execute('pragma journal_mode=WAL')
    db.execute('create table notes(id integer primary key, status text, path text)')
    db.execute('create index status_idx on notes(status)')
    db.execute('create table chunks(id integer primary key,doc_id integer,title text,raw text,title_terms text,body_terms text)')
    db.execute('create index doc_idx on chunks(doc_id)')
    db.executemany('insert into notes values (?,?,?)',[(i,'reviewed' if i%7==0 else 'draft',f'notes/{i}.md') for i in range(10000)])
    db.executemany('insert into chunks values (?,?,?,?,?,?)',rows)
    db.commit()
    start=time.perf_counter()
    db.execute("create virtual table term_fts using fts5(title_terms,body_terms,content='chunks',content_rowid='id')")
    db.execute("insert into term_fts(term_fts) values ('rebuild')")
    db.commit()
    term_build=time.perf_counter()-start
    start=time.perf_counter()
    db.execute("create virtual table raw_fts using fts5(raw,content='chunks',content_rowid='id',tokenize='trigram')")
    db.execute("insert into raw_fts(raw_fts) values ('rebuild')")
    db.commit()
    trigram_build=time.perf_counter()-start
    cases={
      'bigram_bm25_top20':('select rowid,bm25(term_fts,5,1) from term_fts where term_fts match ? order by bm25(term_fts,5,1) limit 20',lambda q:(match(q),)),
      'trigram_bm25_top20':('select rowid,bm25(raw_fts) from raw_fts where raw_fts match ? order by bm25(raw_fts) limit 20',lambda q:(q,)),
      'bigram_filtered_top20':("select rowid,bm25(term_fts,5,1) from term_fts where term_fts match ? and rowid in (select chunks.id from chunks join notes on notes.id=chunks.doc_id where notes.status='reviewed') order by bm25(term_fts,5,1) limit 20",lambda q:(match(q),)),
      'bigram_filtered_materialized_top20':("with hits as materialized (select rowid,bm25(term_fts,5,1) as score from term_fts where term_fts match ?) select hits.rowid,hits.score from hits join chunks on chunks.id=hits.rowid join notes on notes.id=chunks.doc_id where notes.status='reviewed' order by hits.score limit 20",lambda q:(match(q),)),
      'two_char_like_full_count':('select count(*) from chunks where raw like ?',lambda q:('%'+q[:2]+'%',)),
    }
    results={}
    for name,(sql,args) in cases.items():
        elapsed=[]
        for i in range(20):
            q=topics[i%len(topics)]
            t=time.perf_counter(); db.execute(sql,args(q)).fetchall(); elapsed.append((time.perf_counter()-t)*1000)
        elapsed.sort()
        results[name]={'p50_ms':round(statistics.median(elapsed),2),'p95_ms':round(elapsed[int(len(elapsed)*.95)-1],2)}
    for name in ['bigram_filtered_top20','bigram_filtered_materialized_top20']:
        sql,args=cases[name]
        print(json.dumps({'plan':name,'steps':db.execute('explain query plan '+sql,args(topics[0])).fetchall()},ensure_ascii=False),flush=True)
    db.execute('pragma wal_checkpoint(TRUNCATE)')
    print(json.dumps({'synthetic_corpus':{'notes':10000,'chunks':len(rows),'raw_utf8_MiB':round(sum(len(r[3].encode()) for r in rows)/1024**2,2)},'build_seconds':{'bigram':round(term_build,2),'trigram':round(trigram_build,2)},'database_MiB':round(path.stat().st_size/1024**2,2),'warm_engine_only':results},ensure_ascii=False))
