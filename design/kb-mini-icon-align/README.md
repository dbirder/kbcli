# 缩略文字图标居中 · 0.16.3

根因：旧 mini-icon 使用 display:grid 和 place-items:center。新版 3×3 预览改成 display:flex 后，place-items 的水平对齐不作用于 Flex 主轴，匿名文本项从起点排布。

在文件夹缩略容器显式补齐 align-items:center、justify-content:center、text-align:center。不改字体裁切、不引入 text-box、不改图标内容、图片定位或收藏布局。

验证：152 项 Node 测试与打包测试 1 项通过。隔离浏览器检查“编/深/小/I/W/AI/资料”，普通 18px、紧凑 16px、手机 14px 三种缩略容器中，文本 Range 水平中心误差均小于 0.01px、垂直误差为 0；图片图标保持绝对定位、已解码且尺寸等于父色块。真实 Chrome 已重载确认 0.16.3，并查看编程学习预览效果；14 个分组/90 收藏不变。

构建 SHA256：dba24e3c58b97899360733dd069b69cb1d06ca5522c9a633e809e348023cb32a。
