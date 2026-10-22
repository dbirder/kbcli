# NAS：独立 kbcli 镜像与数据分离

2026-10-18 已将现有部署从“三个容器共享完整 hermes-data”迁移为以下布局。Hermes 原镜像、模型配置、服务地址与认证令牌保持原值；API 和调度器运行独立镜像，2026-10-19 已升级为 `kbcli:0.1.4-nas1`。实测见 [迁移验收](verification/nas-layout-2026-10-18.md)。

## 当前目录和挂载

以下目录都在原 Compose 项目目录下：

```text
hermes-data/               Hermes 自身的配置、会话、模型凭据和工作空间
hermes-client/             Hermes 专用只读 CLI 环境、入口和原 agent 令牌
knowledge-base/            原知识库 Git 副本，包括 .git；整体迁移，未重新 clone
kbcli-data/state/          原索引、操作日志、锁及同步记录
kbcli-sync-data/           原调度心跳、pause.json、事件日志和 worker.lock
config/kbcli/api.env       原用户与 agent 令牌，供 API 容器验证身份
config/kbcli/sync.env      仅原用户令牌，供后台自动同步
config/kbcli/ssh/          Git 服务端所需 SSH 文件，只读挂载
kbcli-runtime/            原程序环境和部署副本，保留回滚；正式服务已不挂载
images/                   白名单构建上下文及构建日志
backups/                  权限受限的一致备份、原 Compose 和迁移报告
scripts/kbcli-autosync     NAS 宿主机的同步管理入口
```

| 服务 | 可写 | 只读 |
| --- | --- | --- |
| Hermes | 自己的 hermes-data | hermes-client、knowledge-base |
| kbcli | knowledge-base、kbcli-data/state | kbcli-sync-data、专用 SSH 目录 |
| kbcli-sync | kbcli-sync-data | kbcli-data/state；没有知识库或 SSH 挂载 |

Hermes 的客户端和知识库沿用容器内 `/opt/data/kbcli`、`/opt/data/knowledge-base`，避免旧技能的安装登记与绝对 Python 链接失效。客户端继续通过 `http://kbcli:8765` 操作服务；知识目录只读，变更由 API 校验、记录日志后执行。原有 Hermes 自身凭据保留，未将模型配置提供给 kbcli。

同步容器目前仍只读观察操作日志所在目录，API 则只读观察同步状态，这是现有协议所需的最小共享。后续若用接口提供待提交状态，可再取消调度器的数据库挂载。

## 独立镜像

在开发仓库创建全新的构建上下文，再传到 NAS：

```bash
python3 scripts/build_nas_image_context.py --output /path/to/new/nas-image-context
# 上传整个白名单上下文到 NAS 后：
docker build -t kbcli:0.1.4-nas1 /path/to/nas-image-context
```

构建器只输出当前应用 wheel、带哈希的锁定运行依赖、Dockerfile、健康检查和同步脚本，附文件哈希清单。上下文不包含知识库、Git 私钥、服务 env、本机虚拟环境或开发技能；Docker COPY 再次限定输入。

镜像使用固定 digest 的官方 Python 3.13 slim bookworm，包含 Git、OpenSSH、CA 和时区数据，以 UID/GID 10000 运行。程序位于镜像内的 site-packages，同步脚本位于 `/opt/app/nas_autosync.py`。API 与同步容器复用镜像、运行不同命令；不需要修改 Hermes 镜像。

完整服务段模板见 [compose.kbcli.yaml](../deploy/nas/compose.kbcli.yaml)。该文件用于替换旧服务定义，不应直接叠加到仍挂完整 hermes-data 的旧服务上；否则旧挂载可能因 Compose 合并继续存在。Hermes 的原模型、环境、端口及健康检查保留，仅新增以下两个只读挂载：

```yaml
volumes:
  - ./hermes-data:/opt/data
  # 保留原有部署脚本等挂载，再增加：
  - ./hermes-client:/opt/data/kbcli:ro
  - ./knowledge-base:/opt/data/knowledge-base:ro
```

令牌在运行时由 NAS 的 env_file 提供；现有令牌保持不变，浏览器地址和用户令牌无需重新配置。SSH 的 passwd home 与挂载目标保持一致，Git 凭据只读挂载到 `/opt/data/.ssh`。

## 从旧布局迁移

以下是针对本项目原 NAS 布局的迁移工具，要求已有健康的 Hermes/kbcli/kbcli-sync、UID/GID 10000、原技能登记和 SSH 文件。脚本拒绝覆盖已经存在的新目录；NAS Python 需具备 PyYAML 或 ruamel.yaml。

1. `scripts/migrate_nas_layout.py --compose-dir /path/to/hermes-agent --client-status-launcher /path/to/kbcli/deploy/nas/kbcli-autosync-client.py`：记录原暂停状态；若原先运行，仅创建本次迁移暂停。等待调度结束后停止 API/Hermes，完整归档 hermes-data（含 Git、数据库、配置和凭据），拆分目录、验证知识文件哈希及令牌一致，再使用原镜像启动。备份位于受限的 backups 目录。
2. 第一阶段验证健康、Hermes 客户端、知识文件、操作日志与凭据后，仅当暂停原因仍是本次迁移且原先未暂停，才用 resume 的条件校验恢复。原先存在的冲突/人工暂停不自动清除。
3. 构建独立镜像，在临时知识库测试新增/完成、以只读卷验证实际 Gitee 访问。
4. `scripts/activate_nas_image.py --compose-dir /path/to/hermes-agent --image kbcli:0.1.4-nas1 --expected-version 0.1.4`：备份第一阶段 Compose，再次按原状态暂停调度，仅切换 API 和同步镜像。保持知识与状态挂载、校验原令牌、健康后只恢复本次暂停。Hermes 不需再次重启。

不要将旧虚拟环境直接移动到不同的容器路径，或只复制正在写入的 SQLite 主文件。保留操作日志和暂停标记；索引可重建不代表操作日志可丢弃。迁移期间同一知识库只启动一个正式写入服务。

## 运维

把 [kbcli-autosync-host](../deploy/nas/kbcli-autosync-host) 安装到 Compose 项目的 `scripts/kbcli-autosync` 后，在 NAS 宿主机运行：

```bash
./scripts/kbcli-autosync status
./scripts/kbcli-autosync pause
./scripts/kbcli-autosync resume

docker compose ps
docker compose logs --tail=50 kbcli-sync
```

该入口进入专用调度容器，使用其已有用户身份。Hermes 原来的 `/opt/data/kbcli/bin/kbcli-autosync status` 与 `health` 入口通过只读兼容客户端调用 `/api/autosync`，仍使用 agent 令牌。它不再写调度状态：pause/resume 会明确指向宿主机管理入口；正常模型调用继续仅使用 agent 令牌。暂停/恢复规则与 [自动同步说明](nas-autosync.md) 相同，冲突未解决时 resume 拒绝清除标记。

## 回滚

镜像切换前的 Compose 保存在 `backups/kbcli-image-*/docker-compose.yaml`。回退镜像时先暂停、等待当前同步完成并停止两个 kbcli 服务，再恢复对应 Compose；知识与状态目录保持当前内容，不能用旧归档覆盖新写入。

若确实需要回到最初的共享布局，先核对备份路径，再运行：

```bash
python3 scripts/migrate_nas_layout.py --compose-dir /path/to/hermes-agent \
  --rollback /path/to/hermes-agent/backups/kbcli-layout-TIMESTAMP
```

回滚工具停止服务后把**当前**知识库、日志和同步状态移回旧位置，恢复原 Compose；遇到非空目标目录拒绝覆盖。回滚后仍需验证健康和暂停原因，再按条件显式恢复。完整 tar 备份用于灾难恢复，不作为日常镜像回退时覆盖当前数据的输入。旧镜像和 kbcli-runtime 暂时保留供回滚，后续清理需另行确定。

## 2026-10-19 提交整理与补充验收

本轮补齐迁移和回滚的移动前预检：现有目录、源目录、令牌、客户端入口及回滚目标必须有效，校验失败保留原数据。镜像切换不会清除原有冲突暂停。构建器在独立临时目录生成 wheel，再只复制单个应用包与运行白名单，避免把 uv 的构建元数据带入上下文；失败会清理本次新建的上下文，不覆盖已存在输出。

本地测试、实际上下文构建、NAS 隔离 Git 双副本回归、正式只读状态与挂载检查见 [提交验收](verification/nas-release-2026-10-19.md)。当前正式运行镜像及容器保持原部署；本次未重新执行正式数据迁移、镜像切换或回滚。

NAS 测试入口见 [deploy/nas/README](../deploy/nas/README.md)，浏览器测试代理支持本地 SVG、Markdown 解析器及知识只读接口。原生 Chrome 安装权限验收仍按插件文档单独执行。

## 浏览器备份服务升级（2026-10-19）

当前 API/sync 镜像升级为 `kbcli:0.1.3-nas1`，备份接口、独立设备 JSON 和壁纸去重由 API 提供，继续复用原受控操作日志与 Git 调度器。无需新增容器或扩大 Hermes 挂载与令牌权限。升级过程、保留检查及正式只读复查见[备份验收](verification/chrome-backups-0.5.0.md)。

## 共享同步升级（2026-10-19）

当前 API 与调度镜像为 `kbcli:0.1.4-nas1`。新增仅用户可访问的共享版本接口，保持独立数据挂载、原凭据与持久暂停；Hermes 不重建。详见[0.6.0 部署验收](verification/chrome-workspace-0.6.0.md)。
