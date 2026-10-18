# kbcli v0.1.2 与个人知识库架构

截至 2026-10-19，kbcli 已实现本地 CLI、HTTP API、规范校验、中文检索、受控写入、待办、Git 显式同步以及 knowledge-maintain skill 安装与更新。Chrome 新标签页插件 0.4.1 已提供分组文件夹、自定义背景、Markdown 知识阅读、知识库待办和状态抽屉；NAS 自动同步已有独立调度器和部署记录。原生 Chrome 安装、授权及 worker 重启仍待验收，实际 Hermes 业务流程与长期运行验证继续按部署记录跟进。

本文描述当前实现和后续部署边界。参数与结果格式以 [命令说明](../../skills/knowledge-maintain/references/commands.md) 为准，默认配置以 [config.toml](../../src/kbcli/defaults/.kb/config.toml) 为准。图中的“待开发”“待部署”“待联调”表示尚未完成的部分。

NAS 部署补充：可使用 [独立自动同步调度器](../nas-autosync.md) 调用 v0.1.1 的鉴权 sync API。该调度器不在主程序或 skill 发布包内，部署后提供工具写入自动提交、周期拉取与持久暂停。下文和架构图中“无后台调度”描述的是 v0.1.1 核心自身的行为。

Chrome 部署补充：0.4.1 新标签页（分组收藏、自定义背景、知识库抽屉与只读预览）及 0.1.2 只读同步状态接口见 [插件说明](../chrome-extension.md)。本文架构图保留 v0.1.1 设计快照，当前功能状态以插件说明和命令文档为准。

当前 NAS 已拆分目录并使用独立 kbcli 镜像，挂载与进程边界见 [NAS 部署](../nas-deployment.md)。Hermes 只读访问客户端和知识库，调度器只读观察操作日志，正式数据统一由 API 写入。

## 架构图与范围

- [整体部署图](personal-kb.html)：电脑、知识库 Git 远端、NAS 与访问端的协作关系。
- [软件模块图](kbcli-modules.html)：CLI、HTTP、skill 与已实现的 Python 模块。

每张图的 `.architecture.json` 是可编辑源，HTML 为 archify 生成的交互版本，支持主题切换与导出；同名 SVG、PNG 是同步更新的静态预览。软件模块是同一项目内部职责，不需要分别部署。

| 部分 | 当前实现 | 后续范围 |
|---|---|---|
| 规范、模板、CLI、索引、写入 | 已实现 | 真实语料与长期使用验证 |
| HTTP API、远端 CLI | 已实现，NAS 独立镜像与只读正式链路通过验收 | 外网入口与长期运行验证 |
| Git 后端 | 显式 fetch、快进、push、工具修改提交；独立 NAS 调度器负责周期调用、退避和持久暂停 | 历史分叉需人工整合；长期运行验收见部署记录 |
| knowledge-maintain | 完整发布包、安装、更新、备份、回滚 | Hermes 上的真实检索与写入联调 |
| Chrome 导航页插件 | 已实现 0.4.1，实际 MV3 加载待验收 | 分组收藏、自定义背景、知识库抽屉、Markdown 知识阅读、NAS 待办与状态展示 |
| MCP | 未实现，可选 | 有工具发现需求时适配现有核心或 HTTP |
| 人工复核 | 仅 list/show 和审核有效性校验 | 批准入口、界面与工作流待补充 |

## 数据与软件分别管理

知识库以 Markdown 文件为数据源，`.kb/` 规范与模板和知识内容一同同步。电脑和 NAS 各保留一个工作副本，分别连接同一个知识库 Git 远端；既定方案使用 Gitee，也可换成其他 Git 服务。电脑的 pull/push 直接连接这个远端，不必经过 NAS。

kbcli 源码在本项目及 GitHub 仓库 `dbirder/kbcli` 维护。知识内容同步与软件更新是两条流程：Git 拉取笔记不会升级正在运行的 kbcli；NAS 更新程序或 skill 后需要显式重启服务。

```text
kbcli/                           软件开发仓库（GitHub）
  src/kbcli/                     唯一 Python 程序源码
  extensions/chrome-kb/          Chrome 新标签页源码
  .agents/skills/                仅本项目使用的官方 Chrome/Web 开发技能
  skills/knowledge-maintain/     skill 说明、入口与命令文档
  scripts/build_skill.py        构建完整 skill 发布包
  scripts/install_skill.py      安装、更新与验证
  tests/                        核心、接口、同步、安装与发布测试
  dist/                         本地构建产物，不提交 Git

knowledge-base/                 知识库工作副本（独立 Git 仓库）
  .kb/config.toml
  .kb/schemas/                  common/note/source/project/task/daily-v1.json
  .kb/templates/                note/source/project/task/daily.md
  .agents/skills/knowledge-maintain/  完整 skill 发布包
  inbox/                        临时收集
  sources/                      来源记录与已获取资料
  projects/                     项目概览与过程笔记
  notes/                        整理后的知识
  tasks/                        每项正式待办一个 Markdown 文件
  daily/                        日常记录
  assets/                       随 Git 管理的小附件

machine-state/                  每台机器独立，位于知识库外
  index / operations / locks    可重建索引、持久操作日志与本机锁
  runtime / installation        Python 环境、安装登记与更新备份
```

索引可以重建，操作日志用于写入恢复，不能把二者都当作可随时删除的缓存。NAS 部署时需要分别持久化知识库和运行状态，并独立备份知识内容、附件及必要状态。大附件存储和跨设备访问策略仍需另行确定。

## 当前程序组成

| 代码 | 职责 |
|---|---|
| `cli.py`、`client.py`、`commands.py` | Typer 参数、JSON 输出、远端 HTTP 调用与命令白名单 |
| `api.py` | FastAPI 接口、Bearer 鉴权、用户与 agent 角色、后台索引轮询 |
| `vault.py` | 配置、业务发现、Markdown/YAML、Schema、模板、引用、原文与哈希 |
| `indexing.py` | SQLite FTS5、中文 bigram、BM25、属性筛选、增量刷新与 fresh |
| `operations.py` | create/patch/fix、待办、预期哈希、文件锁、原子写入与操作恢复 |
| `git_sync.py` | Git 状态、受控提交、fetch、快进与 push |
| `status.py`、`state.py` | 内容成熟度与结构分开统计，只读观察已有索引和日志 |
| `autosync_status.py` | 脱敏、只读观察库外自动同步状态和暂停标记 |
| `extensions/chrome-kb/` | 本机收藏、分组、设置抽屉、NAS 待办及状态；收藏与 NAS 请求分别排队 |
| `scripts/` 与 skill | 发布清单、依赖环境、安装更新、启动与维护流程 |

实现使用 Python 3.12+，安装器默认准备 Python 3.13；CLI 使用 Typer，HTTP 使用 FastAPI/Uvicorn，Markdown 使用 markdown-it-py，YAML 使用 ruamel.yaml，本地 JSON Schema 使用 jsonschema/referencing，状态与索引使用 SQLite。本版使用周期扫描，未引入 watchfiles、消息队列、向量库或独立搜索服务。

## 规范、待办与复核

规范选择顺序为显式参数、文档声明、路径规则、目录绑定、默认规范；选出的规范仍必须符合该路径的 allowed 限制。规则使用 `root`、`basename`、`allowed`、`strict`，不使用早期设计中的 `glob` 绑定。

- `tasks/` 严格使用 task-v1；状态为 todo、doing、done、cancelled，due 是可选的本地日历日期。
- `sources/` 严格使用 source-v1；正文尚未获取时保留 capture_status，不把记录来源等同于读过原文。
- `projects/` 下各层 `项目概览.md` 严格使用 project-v1；过程笔记可使用 note-v1。
- 非严格目录允许没有规范声明的旧笔记进入正文检索；已声明规范的记录完整校验。
- 模板生成 UUID、时间与默认字段，Schema 验证格式与约束。校验同时检查重复 ID、关联目标类型、相对 Markdown 链接和来源快照。

任务执行状态与内容审核状态分别管理。用户完成待办只改变执行字段，保留原审核状态，无需再次人工审核，也不会自动批准原来 pending 的内容。HTTP 用户令牌可以完成任务，agent 令牌不能冒充人工完成。普通内容修改按审核规则转为 pending。

审核内容哈希用于判断 approved 是否仍有效，全文件哈希用于并发修改检查，两者不能互换。`review list/show` 目前只查看记录；人工批准命令与 UI 尚未实现。正文里的复选框不自动成为正式待办。

## 检索与写入一致性

各设备独立建索引，中文使用 Han bigram，英文按词处理，SQLite FTS5/BM25 排序；标签、状态和自定义属性用于筛选。单字中文回退原文扫描，literal 核验整个文件字符串，grep 支持原文正则。

普通增量刷新先比较文件 stat，再检查变化文件的哈希；`index --verify`、watch/serve 轮询及 `search --fresh` 提供全哈希核验，覆盖删除、改名和 stat 未变化的修改。检索结果包含路径、章节、行号、片段和文件哈希，read 可以核验目标版本。

`--fresh` 只核验本地文件与索引，不访问远端 Git。另一台电脑未 push 的内容不会出现在 NAS，NAS 未 pull 的内容也不会因索引 fresh 自动出现。实际召回质量、NAS 负载与大规模性能仍需真实语料验收；[研究实验](../../research/search_benchmark.py)使用合成文本，结果不是生产性能承诺。

受控写入先获取本机锁、核验预期哈希并校验变更，持久记录 before/after 原文，然后原子替换文件并刷新索引。恢复时核对实际文件哈希；发现来源不明的修改保留内容并报告。文件保存成功但索引失败时明确报告 `saved: true, indexed: false`。

本机锁仅约束遵守协议的工具，不能锁住 Obsidian 的人工编辑，因此仍需版本核验。NAS 部署建议一个服务协调写入与索引，NAS 上的调用方使用 `--server`，避免多个进程各自维护不同状态。

## Git 同步的实际边界

写入不会自动提交或推送，serve/watch 的后台任务只维护索引；需要显式调用 `sync` 或 `sync --commit-tools`。首次初始化、配置 Git 身份、远端及上游由用户完成。

| 状态 | 当前行为 |
|---|---|
| 没有首次提交、没有配置上游 | 报告 NO_INITIAL_COMMIT 或 UPSTREAM_NOT_CONFIGURED，不自动初始化历史 |
| 上游已配置但本地引用缺失 | 显式同步先 fetch，再核验跟踪引用 |
| 工作区干净、远端领先 | 允许快进更新，再由索引刷新反映文件变化 |
| 工具生成了可确认的修改 | `--commit-tools` 仅提交操作日志能够证明的路径与版本 |
| 有人工修改、未知暂存内容 | 停止整合，保留工作区 |
| 两端历史分叉 | 返回 SYNC_CONFLICT，由人工整合，不自动 merge/rebase/强推 |
| 网络或 push 失败 | 保留本地文件与已有提交，返回实际失败或待推送状态 |

核心不内置 Git 后台调度；独立调度脚本已提供周期同步、退避重试与持久暂停，见 [NAS 自动同步](../nas-autosync.md)。隔离工作区自动合并仍未实现；自动整合即使将来通过格式校验，也仍需处理同一任务被矛盾修改等语义冲突。

## HTTP、skill 与 NAS 部署

本机可启动现有 HTTP 服务：

```bash
# 先在本机环境配置非空 KBCLI_USER_TOKEN；agent 另用 KBCLI_AGENT_TOKEN。
kbcli --vault /data/kb --state-dir /data/kbcli-state serve --host 127.0.0.1 --port 8765

# 客户端设置本机 KBCLI_TOKEN，对应服务端的用户或 agent 令牌。
kbcli --server http://127.0.0.1:8765 task list
kbcli --server http://127.0.0.1:8765 search '同步' --fresh
```

| 接口 | 已实现能力 |
|---|---|
| GET/POST `/api/tasks` | 按状态、标签、逾期筛选与新增待办 |
| PATCH `/api/tasks/{identifier}` | 携带 expect_hash 修改或完成任务 |
| GET `/api/search` | 正文、属性与本地 fresh 查询 |
| GET `/api/read`、`/api/documents/{identifier}` | 按受限路径或 ID 读取原文 |
| GET `/api/recent`、`/api/status`、`/api/review` | 最近修改、默认 portable 状态与待审记录 |
| GET `/api/autosync` | 鉴权、只读观察调度状态；`/api/status` 同时返回认证角色 |
| POST `/api/command` | 远端 CLI 的命令白名单调用，不执行任意 shell |

认证角色来自令牌；本地 `--actor` 只是来源声明。凭据使用本机环境，不写进同步配置。服务默认监听 localhost，TLS 终止、NAS 容器或系统服务托管、开机启动与网络访问控制由部署层负责，现有 Compose 补充配置见 [NAS 自动同步](../nas-autosync.md)。Chrome 扩展按需申请 NAS 主机权限，离线时收藏可用、待办缓存只读；原生 Chrome 授权与本地网络访问验收边界见 [插件说明](../chrome-extension.md)。

完整 skill 发布包含 SKILL.md、命令说明、启动脚本、程序代码、锁定依赖与哈希清单；安装器在知识库外准备环境和登记，支持重复安装、更新备份及失败回滚。仅复制 SKILL.md 不构成完整安装，加载 skill 也不会自动启动 NAS 服务或配置 Hermes 信任。

Hermes 的接入资源已具备，建议通过 skill 调用远端 CLI 使用 NAS 服务；真实 agent 流程仍待联调。MCP 为可选后续适配层，与容器或系统服务的进程托管职责不同。

## 发布与后续验收

v0.1.1 的收尾范围是清理发布输入、同步文档和架构图、验证源码与可安装产物，并建立 GitHub 版本基线。构建产物保留本地，不提交环境、缓存或凭据；重复构建必须使用新的输出目录。详见 [发布说明](../releasing.md) 与 [变更记录](../../CHANGELOG.md)。

后续按以下顺序完成场景：

1. 在既有 NAS 部署与同步验收基础上，继续验证长期运行、重启恢复、状态持久化与断网恢复。
2. 在真实 Chrome 加载插件，验证权限弹窗、worker 重启及待办完成后 NAS 文件、Git 提交推送与电脑拉取结果。
3. Hermes 使用真实来源执行检索、引用、整理与受控写入，验证失败恢复和来源可追溯。
4. 补充人工批准入口，再根据真实语料决定是否需要语义检索或 MCP。
