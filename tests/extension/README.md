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
| verify_backup_integrity.mjs | 私有真实备份副本、清空后恢复、逐字段/图标字节比对、解码、刷新、取消/撤销/再次恢复；仅本机隔离环境 |
| verify_restricted_retry.mjs | 受限项删除保护、跳转目标明确授权/拒绝/单条重试、图标外部回退授权 |
| verify_icon_batch.mjs | 手动批量图标、失败保留、自定义保护/主动替换、权限拒绝、停止、编辑防覆盖与窄屏 |
| verify_site_audit.mjs | 合成 HTTP 状态、默认零勾选、确认/取消删除、撤销、停止、持久结果、旧网址保护及窄屏 |
| verify_frozen_icons.mjs | 两标签页重复打开/刷新/离线零获取、旧缓存本机保留、创建一次与手动编辑计数 |
| verify_capture_lifecycle.mjs（verify_capture.mjs 兼容入口） | 工具栏保存实际关闭、工作台原地编辑、基础输入/草稿、图片、失败保留、分层取消与忙碌保护 |
| verify_spring_folders.mjs | 悬停展开、指定位置插入、快速经过、空分组、边缘滚动、返回首页、取消与并发保护 |
| verify_redesign.mjs | 背景上传、刷新与跨页恢复、重置、收藏文件夹、抽屉、窄屏及减少动效 |
| verify_dialogs.mjs | 原生与兼容层外部关闭、嵌套层级、保存/连接保护、焦点与主页布局 |
| verify_reader.mjs | 三页签控件对齐、Markdown DOM、只读请求、库内链接、迟到响应和窄屏 |
| verify_workspace.mjs | 两个独立来源/设备，共享配置和收藏、离线重启、冲突两种决策、原备份回归 |
| verify_controls.mjs | 自定义菜单选择/取消、日历、闰日、状态保存、禁用项、键盘和窄屏 |
| verify_backups.mjs | 收藏快照、离线 outbox、重载补传、预览确认恢复、撤销与窄屏 |
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

## NAS 接口联调辅助

serve_proxy.py 提供仅接受测试令牌的 loopback 页面代理，静态资源沿用发布白名单，支持知识只读接口；verify_live.mjs 限定给定源的 GET 请求，验证原客户端连接。两者用途、运行边界与 NAS 隔离镜像验收见 [NAS 工具说明](../../deploy/nas/README.md)。

## 备份浏览器验收

`verifyBackups({page,baseURL,screenshotDirectory})` 使用 `serve_fixture.py` 的合成用户令牌；通过实际按钮完成收藏、新增快照、查看历史、预览恢复、外部关闭、确认恢复和撤销。测试专用 `__kbBackupTest` 注入断网并触发一次检查，重载页面验证持久 outbox；不模拟真实 Chrome 的时钟或权限弹窗。worker 注册/启动、存储监听、队列重建和退避由 Node 测试覆盖。fixture shim 和故障开关不会进入发布包。

## 两设备共享同步验收

先在同一全新测试 workspace 顺序启动两个 `serve_fixture.py` 服务，端口如 18778、18779。它们使用同一合成知识库和锁，浏览器来源不同从而具备独立本机存储；各设备仅连接自己的测试源。`verifyWorkspace({a,b,urlA,urlB,screenshotDirectory})` 接收同一个 ego-browser 任务空间的两个页面，真实点击编辑与处理冲突，使用测试专用 `__kbWorkspaceTest.tick()` 代替 Chrome alarm；断网后重载并等待真实退避时间到达，再触发检查。后台 alarm 事件与持久状态由 Node 测试覆盖，不能据此声称原生 Chrome 调度已全部验收。
