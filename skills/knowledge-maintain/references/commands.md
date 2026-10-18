# kbcli v0.1.2 命令与接口

全局参数放在子命令之前，例如 `kbcli --vault /data/kb --state-dir /data/kbcli-state search 同步 --fresh`。结果为 JSON，日志与服务输出留在终端或本机。默认状态路径由 platformdirs 决定，以知识库绝对路径哈希区分；不能把状态目录设在知识库内。

## 常用命令

```bash
kbcli init /path/to/new-vault
kbcli --vault /path/to/kb check
kbcli --vault /path/to/kb index --verify
kbcli --vault /path/to/kb search '同步冲突' --fresh --tag git --under notes
kbcli --vault /path/to/kb search '知识库同步' --literal --fresh
kbcli --vault /path/to/kb search --prop project_name=kbcli
kbcli --vault /path/to/kb grep '同步.*冲突'
kbcli --vault /path/to/kb read notes/example.md --expect-hash 'sha256:...'
kbcli --vault /path/to/kb schema list
kbcli --vault /path/to/kb template show note
kbcli --vault /path/to/kb review list
kbcli --vault /path/to/kb status
kbcli --vault /path/to/kb status --portable
kbcli --vault /path/to/kb doctor
```

check 显示未声明规范的旧笔记警告，声明规范的记录完整校验；tasks 和项目概览等严格范围不会降级。跨文档 UUID 关联要求目标类型正确。根目录说明、规范、skill 和示例不作为业务记录。

status 的 content 汇总目录、实测记录、有效审核、来源获取和任务执行；schema 单独报告结构错误。done 与 pending 是分别合法的执行、审核状态。check/read/grep/list/status/doctor 均不需要缓存写权限。status 只观察已有索引与日志，读取失败时为 observed=false，不能解释为“没有内容或没有待写操作”。state_location 标明 default/configured/explicit 与 temporary。

保存共享摘要使用 status --portable，不包含本机绝对路径。终端完整诊断仍可显示机器路径。默认实测标签为 kbcli-实测，analysis.sample_tags 可设为其他字符串数组；统计结果用于说明积累阶段，不强迫空库或草稿获得人工批准。

search 使用中文 bigram、英文词和 FTS5 BM25，结果按文档聚合，返回原文行号、哈希和 matched_fields。单字中文查询回退为原文扫描；literal 核验整个文件的字符串，grep 返回匹配行。排序相关性仍需真实语料评估。fresh 会核验哈希，超时或持续变化报 INDEX_STALE；数据的 Git 同步状态需要单独通过 status 判断。

review_effective 反映当前内容的审核版本，原始 review_status=approved 没有绑定哈希时为 unverified，内容变化时为 stale。属性筛选只查询原始字段，引用可靠知识时还需查看 review_effective，不把旧的 approved 当作当前有效批准。

## 创建与修改

```bash
kbcli --vault /path/to/kb create 'Git 同步策略' --actor ai --metadata '{"tags":["git"]}'
kbcli --vault /path/to/kb create '项目名称' --template project --actor ai
kbcli --vault /path/to/kb create '日记' --template daily --metadata '{"date":"2026-10-03"}'
kbcli --vault /path/to/kb task add '核对笔记' --due 2026-10-10 --tag git --actor ai
kbcli --vault /path/to/kb task list --status todo
kbcli --vault /path/to/kb task done '<UUID>' --expect-hash 'sha256:...'
kbcli --vault /path/to/kb patch '<UUID>' --expect-hash 'sha256:...' --patch-file change.json --actor ai --dry-run
kbcli --vault /path/to/kb fix notes/legacy.md --dry-run
```

patch 文件支持 set、unset、唯一文本替换和明确的正文替换。例如：

```json
{"set":{"tags":["git"]},"replace":[{"old":"旧的唯一段落","new":"修改后的段落"}]}
```

身份与审核字段受保护，不能用普通 patch 伪造 approved。局部修改尽量保留 YAML 注释和正文；fix 默认预览，实际修复必须加 --apply 和 --expect-hash。无法读取正文的来源保留 capture_status: pending/failed，不依据标题生成摘要。

本地 --actor 为调用者的来源声明，不是安全身份边界；agent 应显式使用 ai。HTTP 的角色由不同令牌核验，不信任请求中的 actor 字段。用户直接完成任务只改变执行状态与时间，原内容审核字段保持不变；待审任务完成后仍是待审内容，AI 完成请求被拒绝。普通内容变化会清除旧审核并设置 pending。

## Git 同步

```bash
kbcli --vault /path/to/kb sync
kbcli --vault /path/to/kb sync --commit-tools
```

先由用户配置 Git 仓库、身份、origin 和上游。工具不会猜测分支，也不会替 nested vault 操作父仓库。commit-tools 只提交操作日志能确认的路径与内容，目标修改之前已存在未提交人工内容时停止；不会把其他暂存文件混入提交。

配置上游与存在本地跟踪引用是两个状态：configured_upstream 显示已配置名称，upstream_ref_present 显示引用是否存在，remote_checked 说明本次是否获取过远端。尚无首次提交报 NO_INITIAL_COMMIT，未配置上游报 UPSTREAM_NOT_CONFIGURED；配置明确时先 fetch，之后引用仍缺失报 UPSTREAM_REF_MISSING。不会因尚未 fetch 就误报为没有上游配置，也不会自动创建首次提交或远端分支。

首次初始化的契约文件和人工笔记需要用户自行提交。同步时脏工作区停止；两端分叉时返回 SYNC_CONFLICT，保留本地提交等待人工整合。断网时保留数据，推送失败返回 PUSH_PENDING。日志包含操作前后版本，恢复存在歧义时报告 RECOVERY_REQUIRED。

## NAS 服务与远端 CLI

```bash
# 在本机环境中准备 KBCLI_USER_TOKEN；需要 agent 时另设 KBCLI_AGENT_TOKEN。
kbcli --vault /data/kb --state-dir /data/kbcli-state serve --host 127.0.0.1 --port 8765

# 客户端本机环境中设置 KBCLI_TOKEN，值对应服务上的用户或 agent 令牌。
kbcli --server http://127.0.0.1:8765 task list
kbcli --server http://127.0.0.1:8765 search '同步' --fresh
kbcli --server http://127.0.0.1:8765 read '<UUID>'
```

NAS 默认只绑定 localhost，通过私网或 HTTPS 入口访问时使用适当的网络托管。令牌不写进共享配置与 skill。--token-env 可指定不同的客户端环境变量名称；NAS CLI 使用 --server，不能在服务运行时另设不同状态目录绕过协调。

API 需要 Bearer token：GET /api/tasks、POST /api/tasks、PATCH /api/tasks/{id}、GET /api/search、GET /api/read、GET /api/documents/{id}、GET /api/recent、GET /api/status、GET /api/review。远端 CLI 使用 POST /api/command，只允许明确的命令与参数，不执行任意 shell。

完成请求格式为：

```json
{"expect_hash":"sha256:...","changes":{"status":"done"}}
```

服务核对用户令牌并补完成时间，保留审核状态。旧版本返回 FILE_CHANGED；agent 令牌不能冒充用户完成任务。review 目前只查看队列与原文，人工批准仍按知识库文档手工执行。

serve/watch 默认周期检查磁盘并更新索引，不自动访问 Git 远端。轮询与写入共享协调锁。人工修改无保存、服务未运行、网络不同步等情况不能宣称 NAS 已看到最新内容。

## Skill 运行

优先从 kbcli 仓库执行 scripts/install_skill.py --vault /path/to/kb。它安装完整发布包、锁定依赖和本机环境登记，成功后可使用普通 Python 启动：

```bash
python3 /path/to/kb/.agents/skills/knowledge-maintain/scripts/run_kbcli.py --vault /path/to/kb check
```

本机环境位置保存在知识库之外，入口会自动切换解释器；移动知识库或跨设备使用时重新安装。用户也可以手工复制完整发布包并准备依赖，使用对应的 Python 执行：

```bash
/path/to/python-env/bin/python /path/to/knowledge-maintain/scripts/run_kbcli.py --vault /path/to/kb check
```

加载 SKILL.md 不会自动安装依赖或启动常驻服务。初次安装应检查版本，NAS 更新发布包后再重启。不同安装器可能只复制被引用资源，本发布包需要完整目录安装。


## Chrome 状态接口补充（v0.1.2）

GET /api/status 返回当前认证 role。GET /api/autosync 使用同一 Bearer 鉴权，只读观察 KBCLI_AUTOSYNC_STATE_DIR 指定的库外调度目录，区分未配置、未启动、运行、重试、暂停、过期和不可读取，不提供暂停/恢复写入口。服务启动前在 NAS 本机环境配置该变量，不能写入同步知识库配置。Chrome 插件的操作范围见仓库 docs/chrome-extension.md。
