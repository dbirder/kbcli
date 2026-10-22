# 网站可用性检查 0.12.0 验收

日期：2026-10-21。用户授权开发手动检查收藏、汇总异常、标记状态与确认后删除。

## 实现范围

- 首页“检查网站”打开原生模态弹窗，“开始检查全部收藏”才请求对应网站主机授权并创建检查任务。
- 4 并发、12 秒超时的 GET；最多读取 64 KiB 文本后取消流，不发送 Cookie/referrer；会话参数网址仅检查根入口并标注范围。
- 队列、claim 租约、部分结果持久化在 chrome.storage.local；关闭弹窗后继续，已有 alarm 恢复手动任务，不自动新建检查。
- 各项包含分组、时间、HTTP 状态及说明；默认展示异常/待确认，可查看全部；卡片显示最近结果。
- 连接错误不虚构证书/DNS 诊断；403/429/安全验证与 HTTP 错误区分。跨域跳转独立待确认，无法访问的跳转也可能显示连接失败，须浏览器复核。
- 删除默认零勾选，必须选择、核对名称、确认。run ID、导航版本、ID 和原 URL 均校验；原子保存本机撤销副本和删除后导航。后续有其他修改时禁止撤销覆盖。
- 检查结果和撤销副本不导出、不上传 NAS。删除当前收藏本身仍按原有同步配置同步；不清除 NAS/Git 历史。

## 验证证据

- `node --test tests/extension/*.test.mjs`：121/121 通过。
- `.venv/bin/python -m pytest tests/test_extension_package.py -q`：1/1 通过。
- Ego 隔离服务（127.0.0.1:18824）使用 6 个合成收藏，验证 200/403/404/503/验证码/延迟入口；结果分别为 ok、restricted、httpError、httpError、restricted、ok。
- 实际界面点击验证默认无勾选、取消删除不改变数据、确认仅删除选中项、撤销恢复、关闭继续、停止保留结果、重载只读旧结果、网址修改后过期且不可删除。
- 隔离检查中图标获取计数为 0。桌面 1280×900、窄屏 390×844 无水平溢出；截图见下。
- 原生 Chrome 已从加载目录 `dist/chrome-kb` 重载至 0.12.0。工作台显示“检查网站”，实际弹窗显示“尚未检查 · 当前 100 个收藏”；首页仍是 15 个分组、100 个收藏。
- 原生验证仅打开入口，未启动真实收藏检查、未新增删除。实际多主机权限提示、长期 worker 挂起恢复没有在真实用户数据上执行；队列恢复和权限拒绝由 Node/隔离测试验证。
- 发布白名单 44 个文件在源码、版本目录与当前安装目录的 SHA-256 全部一致。未操作浏览器数据库、未修改 NAS 连接或图标数据。旧插件文件保存在 `dist/before-site-audit-0.12.0`。

## 产物

- 安装包：`dist/chrome-0.12.0/chrome-kb-0.12.0.zip`
- SHA-256：`d1387e168fb73e7d4659b17165f53f2e97a5a11f0c60d681f734a7933c1318db`
- [桌面异常清单](../images/chrome-kb-0120-audit.png)
- [手机窄屏](../images/chrome-kb-0120-audit-mobile.png)
- [网站状态标记](../images/chrome-kb-0120-audit-badges.png)

## 参考

遵循 [Chrome 跨源网络请求说明](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) 的主机授权边界，以及 [MV3 生命周期说明](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) 的有界请求与持久状态要求。Modern Web Guidance `light-dismiss-a-dialog` 要求使用 showModal、可访问名称、closedby 与旧浏览器回退；新弹窗复用现有 showDialog/bindLightDismiss，兼容最低 Chrome 120。
