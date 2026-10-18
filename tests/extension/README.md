# Chrome 插件验证

## 自动测试

在仓库根目录运行：

```bash
node --test tests/extension/*.test.mjs
uv run --locked pytest -q
uv run --locked ruff check src tests scripts
python3 scripts/build_extension.py --output /tmp/kbcli-extension-release/chrome-kb
```

输出目录及同版本 ZIP 必须不存在；已有构建不会覆盖。Node 用例覆盖收藏、外观、Markdown、消息入口、连接版本与写入边界；Python 覆盖核心、HTTP 及白名单打包。新增纯浏览器模块不依赖前端构建工具。

## 隔离浏览器验收

先启动测试服务（使用新的空目录）：

```bash
uv run --locked python tests/extension/serve_fixture.py --workspace /tmp/kbcli-browser-test --port 18767
```

测试页面是 http://127.0.0.1:18767，令牌 ui-test-user；API 为真实隔离 kbcli，Chrome API 由 chrome-shim.mjs 模拟。示例文章位于 fixtures/article.md，初始化后只写入该临时知识库。测试页面禁止使用正式令牌。

| 模块 | 验证内容 |
|---|---|
| verify_redesign.mjs | 背景上传、刷新与跨页恢复、重置、收藏文件夹、抽屉、窄屏及减少动效 |
| verify_dialogs.mjs | 原生与兼容层外部关闭、嵌套层级、保存/连接保护、焦点与主页布局 |
| verify_reader.mjs | 三页签控件对齐、Markdown DOM、只读请求、库内链接、迟到响应和窄屏 |
| verify_settings.mjs | 真实鼠标逐项操作位置、引擎、主题、滑轨、开关、文件、备份和连接 |

这些模块导出验收函数，接收当前 ego-browser 任务空间的 page；不会自行创建新任务空间。开始前执行 ego-browser skill 并按当前工具版本的说明运行。以下例子中的绝对仓库路径和截图目录需替换为实际位置，截图目录需预先存在：

```javascript
const root = '/absolute/path/to/kbcli';
const base = new URL('file://' + root + '/');
const task = await taskSpace('kbcli settings verification');
const page = task.page('p1');
const secondPage = await task.newPage();
const {verifySettings} = await import(new URL('tests/extension/verify_settings.mjs',base));
console.log(await verifySettings({
  page,secondPage,baseURL:'http://127.0.0.1:18767',
  wallpaperPath:root+'/docs/images/chrome-kb-040-article.png',
  screenshotDirectory:'/tmp/kbcli-browser-screenshots',
  backupPath:'/tmp/kbcli-browser-bookmarks.json',
}));
await task.finish({keep:[]});
```

设置用例必须运行在初始默认设置的隔离页面；复用同一浏览器来源时先核对设置，勿清除真实扩展数据。设置修改用真实点击及键盘，禁止用 selectOption、直接设置 value 或合成 change 代替用户操作；六个位置/引擎选择会核对 isTrusted。其他场景的测试控制（延迟、故障、合成数据）与实际用户交互有明确区分。

场景只接受 127.0.0.1 地址。测试 shim、示例文章和这些脚本都不进入扩展安装包。浏览器验收覆盖页面与接口，不等于原生 MV3 安装、权限弹窗或 worker 生命周期验收。
