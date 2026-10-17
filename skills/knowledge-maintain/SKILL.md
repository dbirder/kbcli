---
name: knowledge-maintain
description: 使用 kbcli 检索、校验和维护 Markdown 知识库，保留来源与内容复核状态。
---

# 使用 kbcli 维护知识库

适用于文件型知识库的检索、来源整理、笔记、项目和待办维护。kbcli 软件开发在独立源码项目中进行。

## 工具与知识库入口

工具的使用约定在本仓库维护。本 skill 的入口是 [scripts/run_kbcli.py](scripts/run_kbcli.py)，操作说明是 [references/commands.md](references/commands.md)；源码与发布包使用同一份文件。使用用户指定的知识库根目录，读取其中 AGENTS.md、.kb/config.toml 及对应规范和模板。

用户要求安装或更新时，按仓库 README 的 AI 安装流程调用 scripts/install_skill.py。安装器会打包完整代码、在知识库外准备锁定依赖并验证 version/doctor；不要只复制 skills 子目录。安装后的入口可以使用普通 python3 启动，它会切换到本机已登记的 Python 环境。

在源码仓库开发时，可以通过 uv run python 调用本 skill 入口，它会使用 src/kbcli，不在两个位置各维护一份程序。源仓库中尚未生成的发布文件并不影响阅读本 skill 的使用说明。

## 操作流程

1. 先执行 check 或查询适用规范；最终文档类型必须满足路径 allowed，项目概览与过程笔记分开。
2. search --fresh 只核验本地索引。先获取少量候选，再用 read 与返回的文件哈希读取原文，按路径、章节和行号引用。
3. 整理外部资料时记录实际读取范围；获取失败不编造摘要。来源、摘要、个人理解与待核实问题分别保存。
4. 新增 AI 内容时 create/task add 显式使用 --actor ai；局部修改先读原文，用 patch --expect-hash，修改前可 dry-run。不要伪造人工审核字段。
5. 用户直接完成任务保持原审核状态，无需再次送审；已有 pending 不因此获批准。远端 agent 令牌不能冒充用户完成动作，应尊重服务返回的角色限制。
6. 写入后 check 并报告保存、提交、推送和索引状态。Git 整合不是每次检索的前置要求，任务开始时按用户已授权的同步策略调用。skill 本身不授权推送或其他外部动作。

## 本地与 NAS 模式

电脑命令使用本地副本。NAS 已运行服务时，调用 --server 并从本机环境获取令牌，交给服务统一协调；不要另外直接写 NAS 工作副本。服务地址与令牌不写入共享 skill。

FILE_CHANGED 表示需重新读取；SCHEMA_INVALID 表示需修正文档；INDEX_STALE 不得声称结果最新；SYNC_CONFLICT 和 DIRTY_WORKTREE 保留两边与未提交内容。写入日志恢复存在歧义时，报告 RECOVERY_REQUIRED，不覆盖当前文件。

分析知识库时使用 status 区分结构、内容积累、审核、来源获取、任务和 Git 版本状态。实测记录与 pending 不等于错误；完成任务仍无需再次审核。缓存不可读或使用临时目录时，明确其观测范围，不把未知状态当作空库。共享报告使用 status --portable，本机路径和完整环境诊断留在本机；项目概览引用新的结果，历史报告保留当时事实。

NO_INITIAL_COMMIT 表示缺少初始版本历史；configured_upstream 已存在但 upstream_ref_present=false 时只说明本地引用缺失。状态查看不访问远端，远端实际状态需要显式授权的同步检查。不要为让状态变绿自动提交、推送、批准内容或改分支名称。

调用 version/help 与命令说明核对当前能力；不要把架构规划当成已实现功能。人工审核批准命令、自动分叉整合、MCP 与 Chrome 插件的状态见命令说明。安装不会启动 NAS 服务或改变 agent 的信任设置。
