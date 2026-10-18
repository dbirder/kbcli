# Chrome 新标签页 0.3.0 验收

日期：2026-10-18。代码位于 extensions/chrome-kb；服务继续使用 kbcli 0.1.2，无需修改 NAS。

## 自动测试

- `node --test tests/extension/*.test.mjs`：34 项通过。
- `.venv/bin/python -m pytest tests/test_extension_package.py tests/test_extension_api.py tests/test_cli_api.py -q`：10 项通过（依赖中的 Starlette/httpx 有一条弃用提示）。
- Ruff 检查构建器及测试通过；`git diff --check` 通过。

新增测试覆盖外观默认值、旧收藏与凭据保留、worker 重启读取、独立版本冲突、容量失败保留旧值、不支持的图片和越界设置拒绝，以及只读知识请求固定端点、路径校验、主机权限与连接版本保护。原待办哈希、冲突、离线缓存只读及写入不自动重放测试继续通过。

## 浏览器实测

使用 ego-browser、隔离的 serve_fixture.py、真实 kbcli HTTP 接口和仅用于测试的 Chrome API shim。测试地址为 127.0.0.1:18772，正式 NAS 与知识库没有写入。

- 首次打开为空收藏，内置背景正常；测试页填充 8 个分组、26 个演示收藏后验证文件夹与全部网站视图。
- 收藏新增、修改、删除、跨视图搜索；删除分组后网站迁入默认组、显示入口开关、文件夹搜索与弹窗关闭焦点恢复；待办新增、修改、直接完成和同步状态可用。
- 知识最近列表、中文/英文关键词检索与文档预览可用，预览正文通过 textContent 显示，不渲染可执行 HTML。
- 使用用户提供的 PNG 截图实际上传，浏览器输出 WebP；位置、遮罩持久化，刷新后保留，第二标签页同步呈现。恢复默认在两页生效；SVG 被拒绝且原背景保留。未把测试图片存入仓库或发布包。
- 外观修改前后 navigation 和 connection 完全一致，沿用旧 schema；收藏备份不增加外观或凭据字段。
- 1440px 桌面知识抽屉为非模态；390px 窄屏为原生模态，连续 Tab 仍留在抽屉内，关闭恢复入口焦点，无页面横向溢出。
- 网络断开后待办展示缓存且禁写，分组和收藏仍可打开；恢复网络后待办恢复可写。
- 开启 prefers-reduced-motion 后过渡为 0s。窗口跨越 760px 断点时收起抽屉，避免在已打开的模态/非模态间错误切换。

可复用场景位于 tests/extension/verify_redesign.mjs，导出 verifyRedesign，由 ego-browser 的当前任务空间传入 page、secondPage、本机 fixture 地址、测试图片路径和截图输出目录。它只接受 127.0.0.1，禁止填写正式凭据。页面关闭后截图等待 display:none，避免把离场动画误当最终状态。

原生 search 输入框可能先用 Escape 清空搜索，再次 Escape 关闭 dialog；测试使用明确关闭按钮，分别验证搜索和焦点返回。

## 发布与范围

构建器包含本地 SVG 和所有新模块的显式白名单，支持子目录，不包含 README、测试 shim、连接数据、用户图片或开发技能。

- ZIP：dist/chrome-kb-0.3.0.zip
- SHA-256：9ed9d927b5286b21fecef04f6fa7897febba18da1cc5640a97661c8e1c94df70
- 解压目录：dist/chrome-kb
- 旧输出保存在 dist/chrome-kb-before-0.3.0-20261018，既有各版本目录和 ZIP 保留。

没有新增 Chrome 权限。当前浏览器工具无法加载未打包 MV3 扩展，以上证明页面和真实隔离接口行为，不替代 Chrome 原生安装、主机授权弹窗和 worker 生命周期验收。升级已有插件时在 chrome://extensions 重新加载后打开新标签页，避免移除扩展丢失本地收藏。
