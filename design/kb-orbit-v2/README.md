# KB 工作台 · 轨迹设计原型

这是一套独立的 UI 重构提案，不是已安装插件的新版本。使用公开演示网站；不访问 chrome.storage、不调用 NAS、不加载远程图标、不持久保存演示改动。

本轮预览：http://127.0.0.1:18828/ 。本机服务停止后可重新启动：

```bash
cd /Users/dbirder/workspaces/project/知识库工具/kbcli
python3 -m http.server 18828 --bind 127.0.0.1 --directory design/kb-orbit-v2
```

- [完整审查和重构规范](review-and-spec.md)
- [视觉 token 与方案自检](design-plan.md)
- [首页](previews/overview-dark.png)
- [分组](previews/group-dark.png)
- [统一编辑](previews/editor-dark.png)
- [设置](previews/settings-dark.png)
- [浅色主题](previews/group-light.png)
- [窄屏](previews/mobile-dark.png)

可点击分组、搜索、编辑、工具、设置、主题与知识库体验方案。原型不包含真实拖拽与生产后端，刷新页面还原演示内容。
