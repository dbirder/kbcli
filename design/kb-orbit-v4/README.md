# KB 工作台：Motion 交互体验原型

2026-10-22。独立设计原型，未接入正式 Chrome 插件数据、chrome.storage 或 NAS。

启动：`python3 -m http.server 18830 --bind 127.0.0.1 --directory design/kb-orbit-v4`

打开 http://127.0.0.1:18830/ 。顶部切换交互手感，然后点「体验一下」：

- 轻盈弹簧（推荐）：Motion spring，22 px 轻抬，设定 duration 380 ms、bounce 0.12。物理弹簧实际稳定时间可能比感知时长长。
- 柔和滑入：12 px 位移，240 ms 缓出。
- 即时响应：取消动画。系统 prefers-reduced-motion 优先。
- 关闭统一 140 ms、8 px 位移及淡出；宽高和文字尺寸保持不变，动画结束再调用 dialog.close()。
- 内部切换 160 ms、6 px 位移；遮罩单独淡入淡出，避免黑幕瞬间跳变。

六类设置：外观与背景、动效体验、搜索与浏览、收藏管理、备份与同步、NAS 连接。
壁纸本地预览、主题、滑块、时钟、知识库显示、紧凑布局和动效可以交互；备份/恢复/同步/连接/导入导出只模拟流程，不发送请求，不触碰真实数据。刷新预览重置演示设置。

研究、设计取舍和功能对应见 [design-notes.md](design-notes.md)。第三方代码与许可见 vendor/。
