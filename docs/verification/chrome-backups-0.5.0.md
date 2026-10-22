# 自动备份、恢复与 NAS 部署验收 — 2026-10-19

## 版本和范围

Chrome 0.5.0 / kbcli 0.1.3，沿用现有 NAS 三容器、共享知识库和原同步参数。实现见[备份设计](../chrome-backups.md)。本次未操作正式浏览器的收藏，也未把测试记录写入正式知识库。

## 自动化与页面验收

- 完整 Python：121 passed；新增备份 13 项，涵盖严格字段/路径、URL/凭据、角色、4 MiB 限制、幂等、设备隔离、去重、篡改、符号链接、日志恢复、Git 提交/推拉与未知修改暂停。
- Node：53 passed；新增备份覆盖上传仅含已知字段、身份持久化、离线后重建 controller、应答丢失幂等重试、上传中新编辑、恢复版本/连接校验、撤销、配额失败、禁用、防抖时间持久化及连接切换等待本机恢复事务。
- Ruff 与模块语法、Git whitespace 检查通过。Python 有现有 Starlette/httpx 弃用提示，未新增失败。
- 真实点击在 loopback 的隔离 API+Chrome shim 页面执行：新增收藏、保存设备名称、手动备份、历史预览、外部点击仅关顶层弹窗、确认替换、撤销、重载补传、桌面/390px 窄屏。
- 恢复后设备 ID 不变；原 NAS 连接不随备份迁移。恢复关闭后焦点返回“预览恢复”按钮；手机恢复窗口无横向溢出，Escape 可关闭。
- 检查截图后将手机备份操作调整为两列，撤销按钮占整行。截图均为合成内容：[恢复预览](../images/chrome-kb-050-restore.png)、[窄屏设置](../images/chrome-kb-050-backup-mobile.png)。

页面操作见 `tests/extension/verify_backups.mjs`。离线注入和单次检查通过测试专用 hook，未用它替代 UI 点击。原生 Chrome MV3 安装、权限提示及真实浏览器关闭/唤醒未由该 shim 验证；worker 事件注册和持久状态由 Node 测试覆盖，长期运行待用户环境继续观察。

## NAS 隔离镜像验收

使用新构建 `kbcli:0.1.3-nas1`，隔离工作目录：

```text
/vol1/1000/System/Docker/docker-compose/hermes-agent/tests/image-acceptance-20261019t095922z/report.json
```

通过：工具写入自动提交推送、周期拉取、待办编辑与人工完成/agent 边界；新增 JSON 备份同 ID 重放、agent 禁止读取、原调度器自动推送、另一 Git 副本拉取并读取恢复内容。历史分叉保持双方 HEAD，暂停标记重启不变。测试容器已清理，结果和测试副本留在 tests 目录。

## 正式升级与只读复查

- 镜像 `kbcli:0.1.3-nas1`（amd64），image ID `sha256:5ca476450af53f1d4bb2c4dfa0d67c1119cddbd185fa09cec418742c68520a6a`。
- Compose 升级备份：`backups/kbcli-image-20261019T100008Z`，相对 NAS Compose 目录；旧镜像仍保留。
- 暂停并排空调度，停止 API/sync 后切换镜像；89 个现有知识文件哈希一致，原用户/agent 令牌值一致。原来未暂停，切换后只解除本次创建的暂停标记。
- Hermes 不重建；Hermes、kbcli、kbcli-sync 最终均 healthy。Hermes 原入口 `kbcli status --portable` 成功读取服务 0.1.3；正式最近知识读取、待办列表、自动同步状态通过。
- 正式 6 条记录、2 条待办、Schema 错误 0；Git clean，HEAD `9ab347073ae3a60242b77bc39123b1ed2994d9cd` 未变，ahead/behind 为 0。同步 idle、worker_alive=true；29 个已安装应用文件及调度脚本与本仓库源码哈希一致。
- 正式备份 GET 接口用户身份成功、当前 0 条快照，agent 返回 403。生产知识库没有验收快照；实际收藏在用户重新加载扩展后开始备份。

## 安装产物

`dist/chrome-kb` 是更新后的加载目录；旧加载目录保存在 `dist/before-backup-0.5.0/chrome-kb`。ZIP：`dist/chrome-kb-0.5.0.zip`，SHA-256：

```text
265f5843e2385826c0580096c58ace6c65b84ba7077c99f8e6dadb00a31fab28
```

21 个白名单资源加 release.json，与源码逐项核对。NAS 保存副本到 Compose 目录 `releases/chrome-kb-0.5.0`，不对外新增下载服务。升级已加载的扩展只需在 `chrome://extensions` 重新加载并新开标签页，不移除扩展；原生 Chrome 此步骤需在用户浏览器完成，避免卸载丢失本机内容。
