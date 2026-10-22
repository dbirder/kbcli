# KB 图标接入 — 2026-10-19

使用用户参考图生成的 kb. 母版，统一项目图标、扩展管理图标、工具栏 action 图标、新标签页 favicon 和首页品牌标识。生成方式与完整提示词见[品牌资源](../../assets/branding/README.md)。

- PNG 16/24/32/48/64/128/256/512 实际尺寸与文件名一致；manifest 的 icons/default_icon 引用逐项核对。
- ICO 包含 16/32/48/128/256 五个有效 PNG 帧，项目 ICO 与插件 favicon.ico 一致。
- 本机实际页面加载首页 128px logo，保留链接 aria-label，图像空 alt；PNG favicon 与 ICO 路径正确。
- 实际检查不同尺寸图标，可辨认 kb. 字样。截图为合成测试页面：[尺寸预览](../images/chrome-kb-061-icons.png)。
- 插件 Node 73 项、Python 白名单打包测试、Ruff 与 whitespace 检查通过。未新增权限或网络资源。
- 本机页面检查不等于原生 Chrome 扩展管理和工具栏已重载；用户需在 chrome://extensions 重新加载插件。

安装包：`dist/chrome-kb-0.6.1.zip`。默认加载目录 `dist/chrome-kb` 已更新，旧目录保存在 `dist/before-brand-icons-0.6.1/chrome-kb`。33 项白名单资源及 release.json；SHA-256：`06a430f955adee68be95ac2f8e612c7ee34db01dca3a2a153def9f41a596bd88`。
