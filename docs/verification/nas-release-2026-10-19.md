# NAS 工具提交验收

日期：2026-10-19，Asia/Shanghai。软件 kbcli 0.1.2，正式镜像 kbcli:0.1.2-nas1。原迁移过程与数据保留结果见 [2026-10-18 记录](nas-layout-2026-10-18.md)。

## 整理与修正

- 收入独立镜像 Dockerfile、认证探针、拆分挂载的 Compose 模板、Hermes 只读兼容入口和管理员调度入口。
- 迁移先检查已有目标、源目录、令牌、客户端入口和符号链接，再移动数据；回滚先检查全部目标非空情况，再停服务或移动当前数据。原有冲突暂停在镜像切换中保留。
- 镜像构建器从独立临时构建目录只复制一个版本匹配的 wheel，再加入锁定依赖与运行白名单；uv 生成的 .gitignore 等构建元数据不进入上下文，已有输出拒绝覆盖，失败只清理本次新建目录。
- 测试代理沿用插件发布资源白名单，补齐默认 SVG、Markdown 库及知识读取路由；只转发测试令牌，限制方法和请求体，不跟随重定向。
- 补充预检、当前数据回滚、已有暂停保留、构建输入白名单和代理路由回归。运行方法见 [NAS 工具说明](../../deploy/nas/README.md)。

## 实际镜像上下文构建

执行 build_nas_image_context.py 成功。上下文只有 .dockerignore、Dockerfile、healthcheck.py、nas_autosync.py、requirements.txt、kbcli-0.1.2-py3-none-any.whl 和 context.json；6 个输入文件的 SHA-256 全部匹配清单。

wheel SHA-256：1a9c46f8bfe49e8dea00bbb7ea43c3990ae69c439e30a4e4786dcfd6d6a820f7。

wheel 内容限定于应用及 dist-info，没有服务 env、SQLite、字节码或 NAS 凭据。构建上下文与运行时数据均不提交 Git。

## NAS 隔离容器与 Git 双副本

运行仓库中的 verify_nas_image.py，使用已有独立镜像、新测试目录、测试令牌、loopback 18770 和本地 bare 远端，所有场景通过：

| 场景 | 结果 |
|---|---|
| API 工具写入自动提交推送 | 远端提交更新 |
| 另一副本修改后的周期拉取 | NAS 测试库标题更新 |
| 日期清除与用户完成 | due 移除，用户完成保持 pending 内容审核 |
| agent 完成限制 | 返回 403 |
| 分叉暂停 | SYNC_CONFLICT，两端 HEAD 保留 |
| worker 重启 | 原 pause.json 字节不变，继续暂停 |

本次报告在 Compose 项目下 tests/image-acceptance-20261018t165128z/report.json（目录名使用 UTC）。隔离 API 与 worker 容器均已移除，测试目录与报告保留供核查。测试没有使用正式知识目录、Git SSH 凭据或 Gitee 作为写入目标。

## 正式服务只读复核

- Hermes、kbcli、kbcli-sync 均为 healthy；当前正式镜像 ID 为 sha256:4a70bcc8209bfa79203d18853c4bfbd7a6d777e2cb5cbc5e5d1573c71e6655fb，linux/amd64。
- 实际容器挂载符合拆分边界：Hermes 的知识库和客户端只读，API 的知识与状态可写、SSH/同步状态只读，调度器没有知识库或 SSH 挂载。
- Hermes 兼容状态入口使用已有 agent 身份取得 idle，worker 存活。
- 正式 API 取得 6 条记录、2 条待办，规范错误 0，知识最近列表与正文读取成功；只输出数量和状态，没有输出正文或令牌。
- 正式 Git HEAD 为 9ab347073ae3a60242b77bc39123b1ed2994d9cd，工作区干净；自动同步为 idle。
- 镜像中 28 个应用源文件与本次仓库源码哈希一致，运行 nas_autosync.py 也与源码一致。
- 使用临时目录和测试 env 文件在 NAS 执行 docker compose config，模板语法、调度器身份及挂载范围检查通过。

本轮没有重新执行正式数据迁移、镜像切换或回滚，也没有重建、重启正式容器。正在运行的镜像用于隔离运行回归；新构建上下文已验证，未另行构建或发布镜像。原始 2026-10-18 的部署记录保留历史状态，当前只读检查结果列于本节。

## 提交前自动回归

以下检查在从最终暂存区导出的干净快照中运行：

- 完整 Python 回归：108 项通过，含 32 项 NAS 布局、上下文和代理用例；其余覆盖核心、API、Git、自动同步、发布与安装。
- Node 插件回归：44 项通过。
- Ruff（src/tests/scripts/deploy/nas）：通过。
- 宿主机 Shell 入口及 Node 只读验证脚本语法检查：通过。
- Docker 上下文实际构建、清单哈希、wheel 文件范围和 Compose 模板解析：通过。
- 新增文档与图片相对链接、提交路径与私钥块检查：通过。

Python 依赖中的 Starlette/httpx 有一条弃用提示，未影响测试。构建产物、NAS 受限备份、环境文件和运行报告不加入 Git。
