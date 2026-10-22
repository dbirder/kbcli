# Chrome 0.6.0 / kbcli 0.1.4 多设备同步验收 — 2026-10-19

## 实现与测试

- 共享收藏、分组、顺序、浏览偏好和外观；设备身份、NAS 连接及令牌保持本机独立。原备份与恢复保留。机制见[共享同步](../chrome-workspace-sync.md)。
- Python 全部 133 项通过，新增 12 项覆盖版本链、幂等、过期提交保护、并发写入唯一胜者、显式新基线、分叉/缺失/篡改、符号链接、字段/角色/体积边界、日志恢复与 Git 双副本。
- 插件 Node 全部 73 项通过，新增共享同步与后台 alarm 用例覆盖两设备、空白初始、离线重启、并发冲突、两种明确处理、旧预览拒绝、应答丢失后基线恢复、接收中继续编辑、配额失败、历史故障、独立备份和设备改名后的幂等接收保护。
- Ruff、模块语法、Git whitespace 和白名单打包测试通过。Python 有既有 Starlette/httpx 弃用提示。

## 浏览器联调

`verify_workspace.mjs` 在一个任务空间内使用两个不同 loopback 来源的页面，具备独立本机存储，服务端指向同一全新合成知识库及文件锁。真实点击编辑收藏/分组/搜索引擎后，另一设备接收；断网编辑、重载、等待真实退避时间并触发检查后补传成功。

同时编辑后，B 保留自己的收藏，A/NAS 共享版本保持另一份。冲突弹窗外部关闭不会清除冲突；“接收共享版本”和“发布本机版本”均实际点击通过，后者可被 A 接收。既有手动备份与历史列表回归通过；取消冲突预览后焦点返回处理按钮，处理完成后返回立即同步按钮。最终预览优先显示有差异的收藏，包括分组及网址，展示完整主要外观/浏览配置。

测试通过专用 `__kbWorkspaceTest.tick()` 触发检查，不代替原生 Chrome 权限与调度验收。真实 alarm 入口和后台状态恢复由 Node 测试覆盖；尚需在用户已加载的 Chrome 中重新加载并长期使用观察。无正式收藏或生产知识被测试数据替换。

- [桌面冲突预览](../images/chrome-kb-060-conflict.png)
- [390px 冲突预览](../images/chrome-kb-060-conflict-mobile.png)

## NAS 隔离验收与升级

镜像 `kbcli:0.1.4-nas1`，amd64 image ID：`sha256:802eb9a9129b1b265ce3469fe984ea0a10e86ecee1abac24b282fdfe1518b2bc`。

NAS 隔离测试报告相对 Compose 目录：`tests/image-acceptance-20261019t140741z/report.json`。工具写入自动提交推送、周期拉取、待办及 agent 边界、原备份幂等/恢复、共享 CAS 与冲突保护、另一 Git 副本拉取共享版本、Git 分叉保留双方 HEAD、重启保留暂停标记均通过。临时容器已清理，报告和测试副本保留。

通过后正式升级 API/sync，Compose 备份：`backups/kbcli-image-20261019T141001Z`。94 个现有知识文件哈希与原用户/agent 令牌保持一致；原先未暂停，只解除本次切换创建的暂停。Hermes 不重建。

正式复查：Hermes、API、sync 均 healthy；Hermes 原客户端入口读取 0.1.4 成功，知识读取、待办和同步状态正常。6 条记录、2 条待办、Schema 错误 0；Git clean、同步 idle、worker_alive=true。当前 Git HEAD 为 `126347ff20d3035dc316b97282d0ec95448fa642`；30 个已安装应用文件和调度脚本哈希与源码一致。

正式共享 GET 用户身份成功，agent 403。正式共享版本目前为空，等待第一台真实设备升级后建立；未用测试收藏初始化正式共享数据。

## 安装包

默认加载目录 `dist/chrome-kb`，旧目录保留于 `dist/before-workspace-0.6.0/chrome-kb`。`dist/chrome-kb-0.6.0.zip` 包含 24 项白名单资源及 release.json，排除测试 hook、凭据与本机数据。SHA-256：

```text
09dd52b092a20cc34b3cf8f56b1d0fc75daeb7da41ebc3e8b6ab66e3dcf17688
```

每台设备需要更新到 0.6.0 并连接同一 NAS；在 chrome://extensions 重新加载原扩展，不要卸载。NAS 保存同哈希安装包到 Compose 目录 `releases/chrome-kb-0.6.0`。更新插件代码与同步用户数据是两个独立步骤。
