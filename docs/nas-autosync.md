# NAS 自动同步

当前 NAS 已采用 [独立镜像与数据分离布局](nas-deployment.md)，实测见 [迁移验收](verification/nas-layout-2026-10-18.md)。下文共享 hermes-data 的目录与 overlay 示例保留为旧部署兼容参考；新部署使用 compose.kbcli.yaml 和宿主机管理入口。

scripts/nas_autosync.py 是独立的 Linux/NAS 调度程序，只依赖 Python 标准库。它通过已有 `/api/command` 调用 `sync(commit_tools=true)`，复用 kbcli 服务的写入锁、操作日志、哈希检查和 Git 快进策略。它不是新的知识写入入口，也不修改 v0.1.1 主程序或 skill 的发布指纹。

## 默认行为

| 条件 | 行为 |
|---|---|
| Hermes 通过 kbcli/API 保存内容 | 每 5 秒检查本机操作日志，发现可提交工具写入后调用同步接口，提交并推送 |
| 没有本机工具写入 | 每 60 秒调用同步接口获取 Gitee 更新，允许快进更新并刷新索引 |
| 同步接口报告未知暂存/工作区内容、哈希变化、待提交记录格式或操作恢复异常 | 记录错误并暂停自动同步，保留文件与已有提交 |
| 历史分叉或推送被拒绝 | 持久暂停，人工整合后显式恢复 |
| 网络或服务暂不可达 | 保留本地数据，按 15、30、60 秒等退避，最大间隔 300 秒 |
| 进程/容器重启 | 读取持久暂停标记；冲突暂停不会因重启而解除 |

修改保存和推送是不同阶段，5 秒为正常轮询间隔，网络失败和暂停期间不能承诺已推送。Hermes 必须通过配置的 kbcli/API 入口维护知识库；直接改 Markdown 的未知人工修改不会被自动打包提交。

自动同步只允许 Git 快进，不自动创建合并提交、rebase、强推、reset 或 checkout 覆盖文件，也不会创建首次提交或猜测上游。用户完成待办的审核规则继续由现有服务处理，调度器不批准内容。

## 部署布局

调度器作为独立 Compose 服务 `kbcli-sync` 托管，使用现有镜像与 UID/GID，挂载相同持久化数据；与服务端共享操作日志的观察路径，所有 Git 修改仍通过 API 执行。

自动提交需要现有 API 的用户身份。调度容器通过 Compose env_file 引用既有 service.env，并使用 `--token-env KBCLI_USER_TOKEN`，这是操作者对后台同步的明确授权。Hermes 的日常调用继续使用 agent 令牌，不能用它自动提交或冒充用户完成待办。控制入口仅查询状态和检查恢复条件，可继续使用 agent 身份；不要把调度器的用户令牌交给模型或写入知识库。

```text
hermes-data/
  knowledge-base/                 知识库 Git 工作副本
  kbcli/
    automation/nas_autosync.py     本项目脚本的部署副本
    bin/kbcli-autosync             固定本机配置的控制入口
    agent-token                   原有 agent 令牌，不进入 Git
    service.env                   原有服务令牌，调度容器使用用户身份
    state/operations.sqlite3      主服务的操作日志，调度器只读观察
    autosync/
      status.json                 心跳、最近成功/失败、下次尝试
      pause.json                  持久暂停原因，正常运行时不存在
      events.jsonl                轮转事件日志
      worker.lock                 限制同一状态目录只有一个后台进程
```

容器命令示例：

```bash
python3 /opt/data/kbcli/automation/nas_autosync.py \
  --server http://kbcli:8765 \
  --token-env KBCLI_USER_TOKEN \
  --journal /opt/data/kbcli/state/operations.sqlite3 \
  --state-dir /opt/data/kbcli/autosync --poll 5 --pull 60 run
```

Compose 应配置 `restart: unless-stopped`，并以相同参数的 `health` 操作进行健康检查。暂停时健康检查失败，便于从 `docker compose ps` 发现；Docker 不会因 unhealthy 自动清除标记。日志应限制容量。服务不可用时 worker 重试，不另起本地 kbcli 绕过锁。

## 部署模板

仓库提供 [Compose overlay](../deploy/nas/compose.autosync.yaml) 和 [控制入口](../deploy/nas/kbcli-autosync)。前提是已有可用的 kbcli HTTP 服务、健康检查、知识库上游、Git 身份与凭据、agent-token 和 service.env；模板不初始化这些内容，也不创建或复制私钥。当前布局使用 UID/GID 10000；不同部署需设置 KBCLI_SYNC_UID/KBCLI_SYNC_GID，并核对其状态目录写权限。

以下在 NAS 宿主机执行。KBCLI_CHECKOUT 指向本仓库的完整 checkout，KBCLI_COMPOSE_DIR 指向已有 Compose 项目；KBCLI_SYNC_IMAGE 设置成正在运行的 kbcli 镜像完整引用，推荐固定 digest，避免引入镜像升级。

```bash
export KBCLI_CHECKOUT='/path/to/kbcli'
export KBCLI_COMPOSE_DIR='/path/to/hermes-agent'
export KBCLI_SYNC_IMAGE='your-existing-kbcli-image@sha256:your-existing-digest'

mkdir -p "$KBCLI_COMPOSE_DIR/hermes-data/kbcli/automation" \
  "$KBCLI_COMPOSE_DIR/hermes-data/kbcli/bin"
install -m 644 "$KBCLI_CHECKOUT/scripts/nas_autosync.py" \
  "$KBCLI_COMPOSE_DIR/hermes-data/kbcli/automation/nas_autosync.py"
install -m 755 "$KBCLI_CHECKOUT/deploy/nas/kbcli-autosync" \
  "$KBCLI_COMPOSE_DIR/hermes-data/kbcli/bin/kbcli-autosync"

docker compose --project-directory "$KBCLI_COMPOSE_DIR" \
  -f "$KBCLI_COMPOSE_DIR/docker-compose.yaml" \
  -f "$KBCLI_CHECKOUT/deploy/nas/compose.autosync.yaml" config --quiet
docker compose --project-directory "$KBCLI_COMPOSE_DIR" \
  -f "$KBCLI_COMPOSE_DIR/docker-compose.yaml" \
  -f "$KBCLI_CHECKOUT/deploy/nas/compose.autosync.yaml" up -d --no-deps kbcli-sync
```

调用 overlay 时后续运维命令继续携带相同的两个 `-f` 参数和镜像变量；也可以在审核后将 kbcli-sync 服务段合入现有 Compose。不要用模板替换整个已有配置。后续更新脚本前备份部署副本，更新后重启 kbcli-sync 并核对状态；保留整个 autosync 状态目录，特别是 pause.json。

## 状态与暂停恢复

NAS 已配置控制入口后，在 Hermes 容器中运行：

```bash
/opt/data/kbcli/bin/kbcli-autosync status
/opt/data/kbcli/bin/kbcli-autosync pause
/opt/data/kbcli/bin/kbcli-autosync resume
```

从 NAS 宿主机执行时：

```bash
docker compose exec --user 10000:10000 -e HOME=/opt/data/home hermes \
  /opt/data/kbcli/bin/kbcli-autosync status
docker compose logs --tail=50 kbcli-sync
```

暂停只停止新的自动同步尝试，不丢弃本机编辑。人工请求 pause 时，已经进入 Git 临界区的当前操作可能先完成；冲突触发的 pause 在同步返回错误后记录。所有写入成功、提交成功和推送成功状态分别报告。

遇到冲突，先查看 pause.json 与 Git 两端版本，保留文件并人工完成整合和校验。resume 会只读检查工作区干净、上游存在、没有未确认恢复记录且结构检查通过，条件不满足时拒绝清除暂停。恢复后下一轮重新 fetch；远端再次变化导致分叉时会再次暂停。不要删除标记来掩盖未解决的冲突，也不要使用强推或覆盖一端来让状态变绿。

调度状态由独立 status 入口查看，v0.1.1 的 `/api/status` 继续报告文件、Git 和索引状态，并不包含这个外部 worker 的暂停标记。

## 验证范围

tests/test_autosync.py 使用真实 Git bare 远端和两个工作副本，覆盖工具修改提前推送、周期拉取、分叉保留、未知人工修改、断网保留提交后重试、暂停跨 worker 实例保留、恢复校验与推送拒绝；FastAPI 接口测试验证 agent 身份被拒绝、明确的用户身份可以自动提交。测试不访问真实 Git 托管服务。

2026-10-18 已完成 NAS 实机隔离故障测试、容器暂停重启测试和一次真实远端双向同步，见 [验收摘要](verification/nas-autosync-2026-10-18.md)。这是该次部署的验收快照，新设备仍需自行验证服务健康、凭据和实际网络链路。原始日志与报告保留在 NAS 库外运行目录，软件仓库不包含它们的凭据、会话正文或知识内容。
