# KB 图标资源

依据用户提供的深青色 `kb.` 图样，使用内置 imagegen 生成正方形母版，保留白色 k、薄荷色 b 和圆点。图标已用于项目 README、插件扩展管理图标、工具栏图标、新标签页 favicon 与首页品牌标识。

| 文件 | 用途 |
|---|---|
| kb-reference.png | 用户原始参考图 |
| kb-icon-master.png | 原始生成母版，1254×1254，保留原始输出 |
| kb-icon.png | 通用 512×512 PNG |
| kb.ico | 16/32/48/128/256 PNG 帧的 ICO |
| ../../extensions/chrome-kb/assets/icons/ | 插件 16/24/32/48/64/128/256/512 PNG 及同源 favicon.ico |

从母版重建：在项目根运行 `python3 scripts/build_brand_icons.py`。尺寸导出使用 macOS sips 或 ImageMagick，不重新调用生成模型、不修改母版。PNG 实际尺寸必须与 manifest 声明一致，扩展图标使用 PNG，不使用 SVG。参照 [Chrome 图标要求](https://developer.chrome.com/docs/extensions/reference/manifest/icons) 与 [action 图标](https://developer.chrome.com/docs/extensions/reference/api/action)。

首页 logo 位于带有目的地 aria-label 的链接内，图像使用空 alt 避免重复播报。功能按钮、网站收藏的图标仍表达各自用途，不会替换成品牌 logo。

## 生成方式与提示词

使用内置 image_gen，未使用 CLI/API fallback。用户参考图为设计依据；生成时请求不透明背景。实际输出母版为 1254×1254。完整提示词见 [generation-prompt.txt](generation-prompt.txt)。
