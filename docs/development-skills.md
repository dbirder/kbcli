# 项目开发技能

Google Chrome 官方开发技能仅安装在本仓库 `.agents/skills/`，供开发 kbcli 的 Chrome 新标签页使用：

| 技能 | 入口 | 用途 |
| --- | --- | --- |
| modern-web-guidance | [SKILL.md](../.agents/skills/modern-web-guidance/SKILL.md) | 现代 Web API、布局、无障碍与性能指南 |
| chrome-extensions | [SKILL.md](../.agents/skills/chrome-extensions/SKILL.md) | Manifest V3、扩展权限、消息、存储与发布参考 |

它们是本项目的开发辅助，不属于安装到知识库中的 `skills/knowledge-maintain/` 发布包，也不会被打进 Chrome 扩展安装包。未安装到用户级 `~/.agents/skills` 或 `~/.codex/skills`，未修改全局配置。

## 来源与验证

- 安装依据：[Chrome 官方扩展开发指南](https://developer.chrome.com/docs/extensions/ai/build-with-ai#modern_web_guidance)。
- 来源仓库：[GoogleChrome/modern-web-guidance](https://github.com/GoogleChrome/modern-web-guidance)。
- 安装提交：`b31dc0a43ff5d19bcf386a3476a216f3b39a6f55`，安装日期：2026-10-18。
- 原始目录：`skills/modern-web-guidance`、`skills/chrome-extensions`；保留原始技能与附带参考文件。
- 共验证 212 个本地文件，以及 chrome-extensions 入口引用的 23 个 Markdown 文件；CLI 启动验证版本为 `0.0.194`。
- 上游采用 Apache-2.0，许可证保存在 [modern-web-guidance-LICENSE](third-party/modern-web-guidance-LICENSE)。

这次安装的是指定提交的本地快照，不配置后台自动更新。后续更新时应继续使用本项目 `.agents/skills/`，不要改成用户级安装。

## 使用

在此项目的后续对话中，可直接要求“使用 chrome-extensions 检查扩展权限”或“使用 modern-web-guidance 改进抽屉”。新安装的技能从下一轮对话起可发现。

modern-web-guidance 的在线检索按技能说明通过 npx 按需运行，需要 Node.js 和网络；npx 按需运行不等于全局安装。受限环境可指定临时缓存，例如：

```bash
NPM_CONFIG_CACHE=/tmp/kbcli-modern-web-guidance-npm \
  npx -y modern-web-guidance@latest search "navigation drawer"
```

此安装不修改现有浏览器、NAS 服务或知识库内容。
