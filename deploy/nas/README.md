# NAS 部署工具

这些文件用于本项目已有 Hermes/kbcli 部署，不是通用目录迁移工具。完整挂载、令牌边界及恢复流程见 [部署说明](../../docs/nas-deployment.md)。

| 入口 | 作用与前提 |
|---|---|
| image/Dockerfile、image/healthcheck.py | 独立 Python 镜像和不输出凭据的认证探针 |
| compose.kbcli.yaml | 拆分后的 API/调度服务模板，替换旧服务段，不直接 overlay 到旧整目录挂载 |
| kbcli-autosync-host | NAS 管理员运行 status/pause/resume，进入调度容器使用既有用户身份 |
| kbcli-autosync-client.py | Hermes 兼容入口，仅 agent 只读 status/health，拒绝 pause/resume |
| ../../scripts/build_nas_image_context.py | 构建 wheel、锁定依赖和显式资源组成的上下文及哈希清单 |
| ../../scripts/migrate_nas_layout.py | 旧共享布局分阶段拆分及保留当前数据的回滚，需要源服务已按原布局运行 |
| ../../scripts/activate_nas_image.py | 已拆分布局切换镜像，保留原有暂停、内容和凭据 |
| ../../scripts/verify_nas_image.py | 在独立目录与临时容器中验证镜像、Git 双副本和冲突暂停 |

迁移与切换需要 NAS 管理权限、Docker Compose、rsync、UID/GID 10000 和 YAML 解析库。先核对现有布局与备份，不对已拆分部署重新运行迁移。命令选项与预检不能代替停写一致备份；脚本输出错误后，按库外报告检查阶段，再使用相应恢复流程。

## 本地验证

```bash
uv run --locked pytest tests/test_nas_layout.py tests/test_nas_image_context.py tests/test_nas_proxy.py tests/test_autosync.py -q
uv run --locked ruff check src tests scripts deploy/nas
sh -n deploy/nas/kbcli-autosync-host
python3 scripts/build_nas_image_context.py --output /path/to/new/nas-context
```

构建器拒绝已有输出；context.json 记录每个实际输入文件的 SHA-256。Docker 上下文不包含知识库、Git 私钥、服务 env、会话或本机环境。镜像由操作者在 NAS 构建，不会因提交源码自动更新。

## NAS 隔离验证

在 NAS 本机用已经构建的镜像运行：

```bash
python3 /path/to/kbcli/scripts/verify_nas_image.py \
  --compose-dir /path/to/hermes-agent --image kbcli:0.1.2-nas1
```

此入口需要已有 API 容器来获取网络，创建 Compose 项目 tests/image-acceptance-* 下的独立知识库、bare 远端和两个副本，使用测试令牌与 loopback 18770 端口。它验证自动提交推送、周期拉取、用户/agent 完成权限、日期清除、冲突保留两端 HEAD 及重启后继续暂停。默认清理自己创建的 API/worker 容器，保留目录和 report.json 供核查；--keep-api 仅在成功后保留隔离 API 以供页面联调。--keep-api 仍只绑定 NAS loopback，不自动发布到局域网；跨设备页面联调需按现有网络策略显式提供隔离 API。应先确认测试端口可用，不向正式 Gitee 写测试内容。

## 浏览器联调

- tests/extension/verify_live.mjs：只读验证原 controller 与服务链路；凭据由操作者的受控运行环境提供，不作为 CLI 参数或写入仓库。请求限定为给定源的状态、待办与自动同步 GET，不提供任务写入。
- tests/extension/serve_proxy.py：仅监听 loopback 的页面代理，默认转发本机隔离 API；--allow-lan-isolated 可显式允许私网隔离 API。只接受 ui-test-user/ui-test-agent，拒绝其他令牌与任意路由，不跟随重定向；读取白名单支持新版知识接口，静态资源沿用插件构建白名单。
- 正式页面的验收脚本和真实点击规则见 [插件测试说明](../../tests/extension/README.md)。代理只用于隔离服务，禁止在页面里填写正式令牌。

## 安装管理入口

在 NAS Compose 目录安装宿主机入口（路径换成实际源码路径）：

```bash
mkdir -p ./scripts
install -m 755 /path/to/kbcli/deploy/nas/kbcli-autosync-host ./scripts/kbcli-autosync
./scripts/kbcli-autosync status
```

status/health 不恢复调度；pause/resume 为管理员显式操作。遇到冲突保留暂停，先处理知识库状态，再按部署文档的条件校验恢复。
