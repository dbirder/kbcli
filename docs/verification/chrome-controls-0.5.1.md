# Chrome 0.5.1 自定义控件验收 — 2026-10-19

## 变更

沿用山雾主页与青绿色调，为设置、收藏编辑、待办和备份区域统一控件外观。开关采用自绘滑块与状态标记；位置、引擎保留单选键盘语义，视觉改为分段按钮；滑轨显示进度和自定义滑块。输入、上传和备份操作统一高度、边框、焦点与禁用状态。最后截图检查发现备份开关行被通用 form label 样式覆盖，已用专用选择器恢复两端对齐。

分组与待办状态由本地自定义列表浮层展示，底层 select 只承担原有值协议、隐藏且不接受 Tab 焦点；标签和错误提示指向可操作控件。截止日期使用文本输入和自定义日历，支持直接填写 ISO 日期、清除和今天。两类浮层均使用 Popover 顶层，JavaScript 进行视口定位，兼容 Chrome 120；不依赖 Chrome 135 的 base-select。

菜单与日历关闭后恢复焦点；菜单 Escape 不写入候选值、Tab/Enter 确认，禁用项不能选。日历方向键移动，Home/End 移到周首/尾，PageUp/PageDown 切月，Shift 加 PageUp/PageDown 切年。父弹窗关闭时一并关闭其浮层。检查中发现原生轻关闭可能在同一次外部点击中同时关闭菜单和父弹窗，已加入指针手势保护；当前一次点击只关闭最上层菜单，保留表单草稿。未新增运行时依赖、权限或后端接口。

## 测试

- Node 58 项通过，新增 5 项覆盖日期合法性、闰年、42 格周一对齐网格、跨月跨年、月末夹取、年份边界和滑轨比例。
- Python 扩展白名单打包测试通过；Ruff、JavaScript 语法及 Git whitespace 检查通过。
- `verify_settings.mjs`：真实点击全部六个位置/引擎选项，核对 isTrusted；方向键、三色调、两个滑轨、时钟和三个显示开关、文件上传/重置、导入/导出、连接/断开、跨标签页、重载和窄屏通过；备份开关实际点击并保存关闭/开启状态。
- `verify_controls.mjs`：真实点击分组菜单、Home/End/方向键、Escape 取消、外部关闭、保存分组；日历闰日、切月、清除、无效日期拦截与实际保存通过；任务状态实际保存为 doing，已完成禁选；390px 下拉浮层位于可视区域。
- 备份回归 `verify_backups.mjs` 通过：自定义设置样式下的快照保存、离线重载补传、历史预览、外部关闭、确认恢复、撤销及窄屏。
- 所有浏览器测试使用 loopback 隔离 API、合成内容和测试令牌，不接触正式收藏或知识内容。Chrome API 由测试 shim 提供，不能替代原生安装和权限提示验收。

## 截图

- [设置控件](../images/chrome-kb-051-settings.png)
- [自定义分组菜单](../images/chrome-kb-051-select.png)
- [日期浮层](../images/chrome-kb-051-calendar.png)
- [390px 设置](../images/chrome-kb-051-mobile-controls.png)

## 使用

发布包为 `dist/chrome-kb-0.5.1.zip`，默认加载目录 `dist/chrome-kb`。在 chrome://extensions 重新加载现有插件，不要卸载，避免丢失本机收藏。NAS kbcli 继续使用现有 0.1.3，无需为本次 UI 调整重建或重启服务。

交互参考：[WAI combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)、[WAI date picker](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog/)、[Chrome Popover](https://developer.chrome.com/blog/introducing-popover-api)。项目现代 Web 指南应用 `forms` 的语义、可见焦点与校验规则，并按自定义组件实现列表和日历。

发布包包含 22 项白名单资源和 release.json；与源码逐项匹配。SHA-256：`ad9a34a0f776cae7bbab2e584261c59d957fd731112503043618dee98a5e882f`。原 0.5.0 加载目录保留于 `dist/before-controls-0.5.1/chrome-kb`。

NAS 已保存同哈希安装包到 Compose 目录 `releases/chrome-kb-0.5.1`，API 镜像和数据不变。
