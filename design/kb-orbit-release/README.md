# Orbit 正式版验收

Chrome 插件 0.15.0，2026-10-22。

- 正式实现：extensions/chrome-kb/workbench-ui.mjs、workbench.css、motion-ui.mjs。
- 完整设置与原功能沿用既有业务模块，Motion 14.6.0 本地打包，权限与 CSP 未扩大。
- 隔离浏览器验收使用 127.0.0.1:18831 和临时测试知识库；新增、编辑、备份恢复、删除撤销均只在测试数据执行。
- Chrome 实机通过 CUA 验证实际安装版本、新标签页覆盖、动画、真实 NAS 待办和文章读取；没有执行真实待办写入、清理或恢复。
- production-before.json 与 production-after.json 的收藏/分组/外观完整规范化哈希一致，包含所有收藏图标内容。15 个分组、91 个收藏保持原样。
- 新增的本机界面偏好不改变现有 navigation、appearance、connection、backup、workspace 载荷。
- validation-summary.json 汇总通过的检查。目录内其他 QA JSON 与 previews/ 为隔离数据证据，部分文件沿用早期测试命名。
- 安装文件：dist/chrome-kb；版本保留目录：dist/chrome-kb-0.15.0；归档：dist/chrome-kb-0.15.0.zip。旧安装文件已保留在 /private/tmp/kb-ui-before-20261022/installed。

已知验证限制：关闭期间的尺寸采样证明未缩放/重排，并非跨设备帧率基准；Chrome 扩展协议的 Performance Resource Timing 条目不能用于证明所有资源是否加载，实际动画另外通过 showModal 包装器及 2 个活动动画核验。
