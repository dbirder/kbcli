# 悬停展开与组内位置投放验收（0.9.1）

日期：2026-10-20。

## 实现

- 首页目标文件夹持续悬停 650ms 后，原生 modal 内展示独立目标网格。源 Sortable 与 dialog 始终连接，不在拖动中销毁/重新挂载，不提前写入存储。
- 按目标网格行、卡片左右半区确定 beforeId；插入线绝对定位，不改变卡片布局。滚动与松手时重新读取当前几何位置。
- 目标视图支持边缘和滚轮滚动，离开窗口回到首页选择其他目标。Esc、标题区、窗口外空白、原分组与指针取消不写入。
- 成功投放后保持目标分组展开并尽量保留目标滚动位置。源分组取消时沿用原列表/滚动状态。aria-labelledby 随预览切换，提示仅内容变化时更新。
- Sortable 本地补丁：新 pointerdown 清理上次拖动遗留的 ignoreNextClick，防止吞掉后续独立点击；当前拖动产生的点击仍被拦截。补丁及 SHA-256 记于 vendor/README.md。

## 验收结果

隔离 loopback fixture 18791，Ego TaskSpace 16，1280×900。合成 5 个分组、52 个收藏；测试不操作真实收藏的顺序。

可复现脚本：tests/extension/verify_spring_folders.mjs，调用方式参照 tests/extension/README.md。

- 悬停目标分组展开 40 个网站，源拖拽节点保持连接；插到第三个网站之前，顺序为 target-0、target-1、source-0、target-2，总数不变，目标窗口保持打开。
- 快速经过目标再悬停其他分组，只展开最后一个目标；Esc 取消后 revision 不变并恢复源分组。
- 目标列表在底部边缘自动滚动超过 100px，滚轮到末尾后追加成功；首页 collection-scroll 不随目标列表滚动。
- 空分组展开并接收网站。
- 从已展开目标拖出窗口返回首页，再悬停另一个分组能正常切换；放在标题处取消，revision 不变。
- 不等待展开直接松手仍可追加，等待 750ms 后无迟到的窗口重新展开。
- 预览期间并发更新 revision：保留新版本，显示其他标签页更新提示，无过时写入，总数仍为 52。
- 91 项 Node 测试通过，包括网格换行、上下空白、可见范围外松手、空分组及滚动后几何命中；扩展打包测试 1/1，JS 语法与 diff 检查通过。

## 安装

构建至 dist/chrome-0.9.1/chrome-kb；替换当前 dist/chrome-kb 前备份至 /private/tmp/kb-installed-before-spring-091。安装目录 release.json 的 0.9.1 文件摘要已全部核对。实际 Chrome 管理页出现空白，运行时控制台输入与管理页刷新未得到响应（CUA 还返回一次 noWindowsAvailable）；未重启浏览器、未卸载扩展，也未写入真实收藏。自动重载和运行版本复核未完成，需在可响应的 chrome://extensions 页面手动重新加载 KB 工作台。
