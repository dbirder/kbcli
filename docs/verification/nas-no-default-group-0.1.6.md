# NAS 无默认分组备份兼容 · 0.1.6

2026-10-23。浏览器取消内置常用分组，服务端备份及共享载荷相应取消 default ID 与非空 groups 的强制要求。网站仍必须引用实际存在的分组，旧载荷保持兼容。

- Python 137 项通过、Node 152 项通过、Ruff 通过。
- 新镜像 kbcli:0.1.6-nas1；无网络临时容器验证零组、自建组备份读回完全一致。
- NAS 隔离 API/sync 验收 ok，测试目录 tests/image-acceptance-20261023t153304z；不触及正式知识库。
- 激活前暂停/停写并一致备份配置、知识库和状态；149 个原文件哈希一致，新记录 0；原先未暂停，激活后仅恢复本次暂停。
- 回退副本：backups/kbcli-image-20261023T153432Z。旧镜像保留。API、sync 和原 Hermes 均 healthy；未修改原凭据与挂载。
- 浏览器按用户要求删除空的常用组后，NAS 共享快照只读核对 groups=14、bookmarks=90、legacyDefaultPresent=false。
