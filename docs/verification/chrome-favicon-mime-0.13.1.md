# Chrome favicon 缺少 Content-Type 的修复

日期：2026-10-22。版本：0.13.1。

用户报告 Kagi 世界新闻的 Chrome `_favicon` 请求可显示图片，但编辑收藏时提示图片加载失败。

## 根因与实际证据

在用户当前 Chrome 开发者工具中只读请求同一内部 favicon 地址：status=200、Content-Type=null、正文 2091 字节，前 8 字节为 137,80,78,71,13,10,26,10（PNG 文件签名）。原 fetchCaptureImage 在读取正文前强制要求 image/* 类型，缺少响应头会直接抛出 IMAGE_UNAVAILABLE，因此不是请求地址错误或实际图片不可用。

## 修改

仅由 source=website/tab 生成的 Chrome 内部 favicon 响应，在大小限制内读完后按 PNG/JPEG/GIF/WebP/ICO 文件签名确定 MIME，再交给现有图片解码/转 WebP 流程。HTML 等未知签名依旧拒绝。外部图片 URL 的类型、授权、8 秒超时、2 MiB 大小及禁止重定向规则保持不变。不添加自动图标加载，也不改动已保存的图标。

单条编辑、创建和批量获取的 Chrome 图标回退共享该读取函数，因此一并修复。

## 验证

- Node 扩展测试：132/132 通过。
- Python 发布白名单测试：1/1 通过。
- 新回归覆盖内部缺少类型头、octet-stream/text/plain 但实际 PNG、HTML 伪装图片、外部缺少类型头仍拒绝、超限拒绝，以及批量 Chrome 回退。
- 原生 Chrome 扩展详情页确认运行版本为 0.13.1。
- 实际打开 Kagi 世界新闻的编辑图标窗口，点击手动获取后显示“图片已加载；保存后使用本地图标。”用户未保存的草稿恢复，图标预览已保留；本轮未点击保存修改，未替换真实收藏图标。
- 工作台在重载后仍显示 15 个分组、91 个收藏。

安装包：dist/chrome-0.13.1/chrome-kb-0.13.1.zip。
SHA-256：8ea64e944423b728f4ddcb838c0c4e69dcb1ba23760287b7c65012f87a3cfc06。
旧插件文件：dist/before-favicon-mime-0.13.1。
