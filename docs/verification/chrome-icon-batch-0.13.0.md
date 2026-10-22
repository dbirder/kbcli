# 批量获取网站图标 0.13.0 验收

日期：2026-10-22。

## 功能

首页“获取图标”与设置 → 收藏数据 → “批量获取网站图标”打开同一工具。用户点击“一键获取全部图标”后才申请目标站点权限并创建任务，默认保留自定义图片/文字，可勾选替换。旧数据无来源字段，文字通过与默认首字/颜色相等来识别自动回退；默认样式完全相同的手动文字不能区分，文档已说明。

最多 4 并发，同批同 origin 共享一次获取。优先请求 origin/favicon.ico，失败后尝试 Chrome favicon，并与 Chrome 默认图标比较。图片请求不携带 Cookie/referrer，不发送收藏路径或查询参数；成功规范化为 128×128 WebP，单条 32 KiB、总计 1 MiB。失败或容量不足保留原图标。

队列、claim、进度与逐项结果仅本机保存；Chrome alarm 恢复手动任务，关闭弹窗继续，可手动停止。保存图标沿用原有收藏导出、NAS 备份和多设备同步。打开、刷新新标签页和展开分组不自动获取图标。并发手动编辑网址/图标、删除收藏和旧任务迟到响应均不会被覆盖；保存与任务结果原子写入。

## 验证

- `node --test tests/extension/*.test.mjs`：130/130 通过，含 8 项批量图标用例与真实 worker 消息入口/权限白名单测试。
- `.venv/bin/python -m pytest tests/test_extension_package.py -q`：1/1 通过。
- Ego 本机隔离服务 127.0.0.1:18825，5 个合成收藏默认结果：updated、failed、protected、protected、updated。
- 真实界面点击验证：权限拒绝不创建任务、默认自定义保护、主动替换、失败保留、重新打开零请求、手动修改优先、停止后不写迟到结果。
- 原有 verifyFrozenIcons 回归通过：新标签页重复打开/刷新/离线/展开分组均无自动获取；创建一次与手动编辑计数仍符合预期。
- 桌面 1280×900、窄屏 390×844 无水平溢出；原生 dialog 复用 showDialog/bindLightDismiss，保留 Chrome 120 关闭回退。
- 测试空间与本机服务已关闭。所有测试只使用合成收藏，不使用真实令牌和收藏。
- 源码、版本目录与当前安装目录的 46 个白名单文件 SHA-256 一致。旧安装文件已备份到 dist/before-icon-batch-0.13.0。
- 用户解锁后，原生 Chrome 扩展详情页已确认从 0.12.0 重载到 0.13.0。新标签页出现“获取图标”入口，实际弹窗正常显示“一键获取全部图标”、默认关闭的自定义替换选项和初始进度。
- 本轮升级前后均为 15 个分组、91 个收藏（以用户解锁后的当前数据为准）；未恢复旧计数、未新增删除，也未自动启动真实收藏的批量图标获取。真实批量网络请求与主机权限提示未在本轮执行，失败/保护/并发与持久化已由隔离界面和自动化测试覆盖。

## 产物

- `dist/chrome-0.13.0/chrome-kb-0.13.0.zip`
- SHA-256：1634136c13d4bb01b7fb9cb8fd28003d1ceaef3f8e601db9b22c4ba5310e7db3
- [桌面](../images/chrome-kb-0130-icon-batch.png)
- [窄屏](../images/chrome-kb-0130-icon-batch-mobile.png)

Modern Web Guidance light-dismiss-a-dialog 要求 “Always open modal dialogs with showModal()”。新工具沿用原生顶层弹窗、可访问名称和旧版关闭回退，不引入额外 UI 依赖。
