# 知识库配置与规范

config.toml 定义目录、规范绑定、模板与复核契约。schemas/ 使用 JSON Schema 2020-12；模板使用 Markdown 与 YAML frontmatter。kbcli v0.1.1 已实现加载、校验与模板生成。

## 规范选择与目录约束

选择优先级为命令显式指定、文档声明、路径规则、目录绑定、默认规范。选择完成后，仍要检查规范是否属于该路径允许的 allowed；显式参数也不能绕过这个约束。例如 tasks/ 只允许 task-v1，不能声明 note-v1 后被待办列表漏掉。

projects/ 下名为 项目概览.md 的文件使用 project-v1 并严格校验；其他项目过程笔记默认使用 note-v1，也可以显式声明 project-v1。项目 UUID 关联的是项目卡片，不是任意项目过程笔记。路径规则按 root 和 basename 匹配所有子目录；重叠规则需要报告歧义。

严格范围的无元数据记录作为错误。非严格范围的旧笔记没有 schema 声明时可以降级为正文检索并报告提示；声明了 schema 的文件完整校验，不能借 strict=false 忽略字段错误。

## 本地规范与版本

common-v1.json 定义通用字段，其他规范通过 URN 引用。加载器把所有规范注册到本地 registry，不通过网络解析 URN。UUID、日期、时间与 URI 的 format 检查必须启用；模板生成器负责默认值，JSON Schema 的 default 不生成字段。

schema_version 是配置版本，规范标识、工具协议与索引版本分别管理。修改必填字段或枚举等不兼容变化应新增规范版本并提供迁移，不能仅修改软件版本。

业务发现仅扫描 config.toml 的 roots。说明文件、docs/、.kb/、.agents/ 和 agent 本机运行目录不作为知识内容索引。

## 运行环境与审核

本机路径、凭据、端口与轮询间隔使用命令参数或环境变量，运行状态保存在知识库外；当前不加载 config.local.toml。完整 .agents/skills/knowledge-maintain 发布包包含维护流程、配套 Python 代码和锁定依赖清单，Python 环境由安装器在知识库外单独准备。

审核队列覆盖全部业务 roots，但只返回 pending 或 needs_changes 的记录。用户直接完成任务保留原内容审核状态，不自动批准已有内容。review list/show 仅查看待审记录；当前没有人工批准命令。
