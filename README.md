# kbcli

Python 开发的 Markdown 知识库工具。这个仓库同时维护程序源码、knowledge-maintain skill、命令说明与安装器，是工具使用方式的唯一维护来源。当前版本 v0.1.2 提供本地 CLI、稳定 JSON 输出和同一核心的 HTTP 服务；Markdown 为数据源，索引、日志和运行环境保存在知识库外。

当前是可本地试用的 MVP：[Chrome 新标签页插件](docs/chrome-extension.md) 已提供磨砂分组文件夹、自定义背景、按需知识库抽屉、Markdown 知识阅读、待办管理和状态展示；MCP 和人工批准命令尚未实现。serve 本身只维护索引；NAS 可单独部署 [自动同步调度器](docs/nas-autosync.md)，复用现有 HTTP 同步接口。实现边界见 [架构说明](docs/architecture/README.md)，版本整理见 [变更记录](CHANGELOG.md)，构建与验收见 [发布流程](docs/releasing.md)。

## 安装 knowledge-maintain skill

已有 uv 和 Python 3.11+ 时，在仓库目录执行：

```bash
python3 scripts/install_skill.py --vault '/path/to/knowledge-base'
```

安装器读取已存在的知识库配置，构建完整发布包，安装到 `.agents/skills/knowledge-maintain`，在知识库外准备 Python 3.13 与锁定依赖，并执行 `version` 和 `doctor`。不需要先安装本项目开发依赖，也不会初始化知识内容、提交推送 Git 或启动服务。

相同完整版本再次安装只验证现有环境。更新已有本项目发布包时使用 `--update`，替换前完整备份，失败恢复旧版本：

```bash
python3 scripts/install_skill.py --vault '/path/to/knowledge-base' --update
python3 scripts/install_skill.py --vault '/path/to/knowledge-base' --dry-run
```

安装成功后，不用再寻找环境路径：

```bash
python3 '/path/to/knowledge-base/.agents/skills/knowledge-maintain/scripts/run_kbcli.py' \
  --vault '/path/to/knowledge-base' check
```

可用 `--runtime-dir` 指定知识库外的环境父目录，`--python` 选择解释器，`--offline` 限定使用 uv 缓存。知识库移到新路径或在另一台设备使用时，重新运行安装器准备该机器的环境。仅复制 SKILL.md 或 skills 子目录不构成完整安装。

## 给 AI 的安装流程

当用户明确要求“读取此 README 并安装或更新 skill”时，按以下步骤执行；仅阅读文档不会触发设备变更。

1. 使用当前完整仓库 checkout。若从 GitHub 获取，使用用户授权的 Git 认证并选择所需版本；先核对 pyproject.toml、uv.lock、skills/ 和 scripts/install_skill.py 均存在，不把空仓库当作已发布版本。
2. 确定知识库根目录。优先使用用户提供的路径；当前目录有 .kb/config.toml 时可使用当前目录。没有路径信息时询问目标目录，不照抄本文示例。已有知识库不运行 init。
3. 检查 uv 和 Python 3.11+。缺少 uv 时按其官方安装文档处理；仅有 uv 时可用 `uv run --no-project --python 3.13 scripts/install_skill.py ...` 启动安装器。[uv 安装说明](https://docs.astral.sh/uv/getting-started/installation/)
4. 调用 `python3 scripts/install_skill.py --vault "目标目录"`。用户已要求升级或重新安装本项目发布包时加 --update；它会先备份。其他或未标识的同名 skill 不覆盖。权限或网络失败时返回实际原因，不绕过失败宣称安装成功。
5. 读取安装器 JSON 输出，确认 ok=true、版本一致、doctor 通过。使用安装后的 scripts/run_kbcli.py 再执行 check；既有知识格式问题单独报告，不为通过检查改写用户内容。
6. 报告 skill 位置、版本、验证结果和备份位置。让目标 agent 在知识库目录使用该 skill；Hermes 初次项目信任按其配置流程处理，安装器不自动改信任、令牌或 NAS 服务。

可直接给 AI 这样的请求：

> 请读取 kbcli 仓库 README，按其中安装流程把 knowledge-maintain 安装到我的知识库「实际目录」，保留已有内容，验证后告诉我位置和版本。

从 GitHub 获取完整源码后安装：

```bash
git clone https://github.com/dbirder/kbcli.git
cd kbcli
python3 scripts/install_skill.py --vault '/path/to/knowledge-base'
```

## 安装与运行

```bash
uv sync
uv run kbcli --help
uv run kbcli --vault '/Users/dbirder/Documents/知识库/kb' check
uv run kbcli --vault '/Users/dbirder/Documents/知识库/kb' search '同步' --fresh
uv run kbcli --vault '/Users/dbirder/Documents/知识库/kb' task list
```

已有知识库不会被 init 覆盖。新的目录可以使用 `kbcli init /path/to/new-vault`，或者 `kbcli init /path/to/new-vault --defaults /path/to/existing-vault` 复制现有 .kb 契约；不复制凭据或运行状态，也不初始化 Git。

## 已实现功能

- `check`：本地 JSON Schema、格式、目录类型、重复 ID、UUID 引用类型、相对 Markdown 链接和审核版本检查。
- `index`、`watch`：SQLite FTS5 中文 bigram 索引，增量更新、全哈希核验及周期对账。
- `search`、`grep`、`read`：正文与元数据查询、原文字符串或正则匹配、路径与行号、哈希核验。
- `create`、`patch`、`fix`：模板创建、受控修改、修复预览、原子写入与操作恢复记录。
- `task list/add/update/done`：任务管理，用户完成任务保留内容审核状态。
- `schema`、`template`、`review list/show`、`status`、`doctor`：规范、模板、待审列表及运行诊断。
- `sync`：明确配置上游之后执行 fetch、fast-forward 和 push；`--commit-tools` 仅提交可确认的工具写入。
- `serve`、`--server`：HTTP API 与远端 CLI。用户和 agent 使用不同令牌，角色来自服务认证。

详细接口与示例统一维护在 [skill 命令说明](skills/knowledge-maintain/references/commands.md)，流程入口是 [SKILL.md](skills/knowledge-maintain/SKILL.md)。整体目标见 [架构说明](docs/architecture/README.md)，尚未实现的设计不能当作当前能力。

## 知识库状态与只读诊断

`status` 分别报告结构检查、业务目录数量、实测与非实测记录、有效审核、来源获取、任务执行、Git 历史、索引和操作日志。`0 错误`只表示结构合规，不能代表来源已经读取、内容已经批准或已有可恢复的版本历史。默认以 `kbcli-实测` 标签识别实测记录，可通过 analysis.sample_tags 配置。

```bash
uv run kbcli --vault '/path/to/kb' status
uv run kbcli --vault '/path/to/kb' status --portable
```

portable 适合保存到可同步报告，省略本机绝对路径。HTTP 状态接口默认 portable；本机完整诊断用于终端或本机状态目录。历史实测报告保留当时结果，新的阶段生成新报告，并在项目概览中引用最新结果。

check/read/grep、任务和复核列表、status/doctor 不要求状态目录可写。状态查看不创建空索引、不恢复操作日志；不可读时返回 observed=false 和未知值。显式临时状态目录有 temporary 标记，不能当作默认缓存。index、search 首次建索引和写入仍需要库外可写状态目录。

Git 状态区分 unborn、detached、dirty、clean、diverged，以及 configured_upstream 和 upstream_ref_present。状态查看不访问远端；显式同步在有首次提交、上游明确且工作区干净时先 fetch，再检查跟踪引用。未做首次提交返回 NO_INITIAL_COMMIT，不自动提交现有知识内容。

## 运行约定

所有业务命令默认输出 JSON；`--json` 为兼容调用保留。`--vault`、`--state-dir` 和 `--server` 放在子命令之前。退出码 0 为成功，1 为 check 发现规范错误，2 为业务或输入错误。

`--fresh` 核验的是本地文件与索引，不能获取另一台电脑尚未推送的内容。普通查询报告待更新文件和命中版本。索引更新与 Git 同步分别呈现状态。

写入先记录 before/after 原文，再替换文件；中断后根据当前哈希恢复记录，遇到未知变化保留内容并报告。数据已保存但索引失败时明确返回 `saved: true, indexed: false`，避免误判成未保存。

Git 同步拒绝脏工作区、未知修改、父仓库和分叉历史，不自动强推或 rebase。写入本身不会暗中提交或推送；显式 sync 才访问远端。本机文件锁约束工具之间的写入，Obsidian 手工编辑仍需要版本再检查。

## Skill 发布

```bash
uv run python scripts/build_skill.py --output dist/knowledge-maintain
```

发布目录包含同一份 SKILL.md、命令说明、启动脚本、配套 Python 代码、锁定依赖与文件哈希清单。通常使用上述安装器，它会完整构建、验证与安装，不依赖预先存在的 dist 目录。手工部署需要完整复制发布包并单独准备依赖。

构建排除 macOS 元数据、字节码、环境、缓存与编辑器临时文件，同时保留隐藏的 `.kb/` 默认规范。dist 不提交 Git，输出目录必须尚不存在，完整验证步骤见 [发布流程](docs/releasing.md)。

```text
src/kbcli/                         程序源码
skills/knowledge-maintain/         skill 源码与唯一命令说明
scripts/build_skill.py             构建完整发布包
scripts/install_skill.py           本机安装、更新与验证
dist/knowledge-maintain/           构建产物，不手工维护
```

源码继续在此项目维护。发布包为受控版本，NAS 软件升级后重启服务，知识内容的 Git 同步不等于正在运行的软件已更新。

## 测试与范围

```bash
uv run pytest -q
uv run ruff check src tests scripts
node --test tests/extension/*.test.mjs
```

测试覆盖中文检索与原文定位、同 stat 修改、改名与删除、Schema 路由、旧哈希拒绝、评论保留、并发修改、完成任务不重新审核、API 角色、远端 CLI、写入日志恢复和两个临时 Git 工作副本。

当前不提供人工审核批准命令或 MCP；Git 分叉需要人工整合。watch/serve 采用周期核验，后台服务默认只维护索引，Git 同步需要显式调用。需要手工修复的 YAML、复杂 Obsidian 块与 Wiki 链接语义仍有后续工作。


## Chrome 新标签页插件

从 [extensions/chrome-kb](extensions/chrome-kb/README.md) 加载未打包扩展，或运行 `python3 scripts/build_extension.py` 构建安装包。收藏、分组和显示偏好保存在本机，可离线使用；知识库侧栏需要 kbcli 0.1.2+ 的用户身份与只读同步状态接口，详见 [插件说明](docs/chrome-extension.md)。

本项目已在 `.agents/skills/` 安装 Google Chrome 官方 `modern-web-guidance` 和 `chrome-extensions` 开发技能，仅作用于本仓库。来源、使用方式与更新边界见 [项目开发技能](docs/development-skills.md)。

## NAS 独立部署

当前 NAS 将 Hermes、知识库、kbcli 状态与自动同步状态分目录挂载，API 和调度器运行独立的 kbcli 镜像。镜像构建、迁移、管理与回滚见 [NAS 部署说明](docs/nas-deployment.md)，实测结果见 [迁移验收](docs/verification/nas-layout-2026-10-18.md)。
