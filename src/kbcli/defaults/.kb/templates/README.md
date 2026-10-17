# 模板变量

模板是创建新文件的起点，本身不是合法的业务实例。复制到对应目录后，替换所有变量，再保存。

| 变量 | 内容 |
|---|---|
| uuid | 新生成的唯一 UUID |
| title | 文档标题 |
| created_at、updated_at | 带时区 ISO 8601 时间，例如 2026-10-03T18:10:00+08:00 |
| created_by | human 或 ai |
| review_status | AI 内容默认 pending；人工笔记、日记和待办没有待审内容时删除此行；来源记录仍需填写 |
| source_type | web、book、document、video、audio、other |
| url | 实际原始链接；非 web 来源没有链接时删除此字段 |
| date | YYYY-MM-DD |

task 的 due 默认省略，确定日期后再添加。项目与来源关联填写 UUID 数组，正文另外写相对链接。AI 生成的审核内容保留待复核标记，工具不能代填人工批准。用户直接完成待办保留原审核字段，不重新送审；任务执行状态与内容复核分别显示。
