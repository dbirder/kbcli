# 整卡直接拖动验收（0.8.1）

日期：2026-10-20。

取消 SortableJS handle 限制，分组和网站主体、图标、名称均可启动拖动。编辑及排序控件用 filter 排除，preventOnFilter:false 保留其点击。桌面 fallbackTolerance=8；触屏 delay=250 / delayOnTouchOnly=true / touchStartThreshold=6。原键盘手柄在焦点或管理模式可见，普通鼠标悬停不再显示多余手柄。

## 验证

- Node 84/84 通过，Python 打包 1/1 通过，git diff --check 通过。
- Ego 隔离 fixture 18788，3 个分组、初始 8 个网站，触屏与跨组阶段扩充至 33 个合成网站。
- 鼠标直接从分组图标中心拖动，分组顺序变成“编程学习、常用、开发工具”；未误打开文件夹。
- 鼠标直接从网站图标中心拖过 4 张卡片，网站 1 移到网站 5 后面，持久顺序正确；页面仍仅 1 个，没有误开网站。
- 普通点击网站仍打开正确 URL，编辑按钮正常打开网站表单。
- CDP 真实触摸输入：短滑后排序未启动，列表滚动 75px；长按等待选中后移动可排序，释放后正常保存。
- 从网站卡片主体拖到“常用”目标分组，跨组移动成功，总数保持 33，未误开新页。
- 当前 Chrome 沿 dist/chrome-kb 原路径重新加载，详情确认 0.8.1，工作台保留 15 个分组 / 101 个收藏。正式收藏未为测试调整顺序。

持久图标缓存、权限、收藏结构及 NAS 接口不变。
原安装文件备份：/private/tmp/kb-installed-before-direct-drag-081。
发布包：dist/chrome-0.8.1/chrome-kb-0.8.1.zip。
SHA-256：5f398c23effc9e7e7dc1ba1b61dbbde5901e3509ae5b29890eb67e8f5215df11。
