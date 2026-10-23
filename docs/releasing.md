# 构建与发布

版本号同时维护于 `pyproject.toml` 和 `src/kbcli/__init__.py`。源码、skill 说明和默认规范只在本仓库维护，dist 是派生结果，不提交 Git。对外发布前记录变更和验证边界；仓库提交、Git tag、GitHub Release、NAS 部署是分别执行的步骤。

## 验证与构建

在安装好 uv 的完整 checkout 中运行：

```bash
uv sync --locked
uv run --locked ruff check src tests scripts
uv run --locked pytest -q
uv build --out-dir /path/to/new-release/python
uv run --locked python scripts/build_skill.py --output /path/to/new-release/knowledge-maintain
```

skill 输出目录必须尚不存在，避免混入旧版本文件。可以用 `UV_CACHE_DIR` 指定可写缓存；离线构建在依赖和构建工具已缓存时使用 `--offline`。构建完整 skill 时，安装器会自行构建，不需要预先有 dist。

构建器应排除 `.DS_Store`、AppleDouble/`__MACOSX`、Python 字节码、运行环境、缓存和编辑器临时文件，同时保留隐藏的 `defaults/.kb/` 规范。wheel、sdist 和 skill 发布目录都需要检查，不能只依赖 Git ignore。skill 的 `release.json` 记录版本、运行时和各文件哈希；fingerprint 变化表示完整包变化，同一版本重新构建也应以该清单核验。

依赖导出省略 uv 的命令注释头，在线和离线模式的相同输入应生成相同 requirements.txt 与发布指纹。

## 独立安装验收

先在临时知识库验证，避免把构建验收写入真实笔记：

```bash
uv run --locked kbcli init /path/to/new-test-vault
python3 scripts/install_skill.py --vault /path/to/new-test-vault
python3 /path/to/new-test-vault/.agents/skills/knowledge-maintain/scripts/run_kbcli.py version
python3 /path/to/new-test-vault/.agents/skills/knowledge-maintain/scripts/run_kbcli.py --vault /path/to/new-test-vault check
```

安装器需 Python 3.11+ 和 uv，应用需 Python 3.12+，默认环境使用 Python 3.13。已有受控安装使用 `--update`，保留备份，失败恢复旧包与登记。已有真实知识库不运行 init；软件更新也不自动提交知识内容、推送或重启服务。

测试覆盖核心操作、API、两个临时 Git 副本、安装回滚和发布清洁性。本机测试不能替代 NAS/Linux、多设备、真实网络或 Chrome 插件的集成验收。

## Chrome 插件

插件版本独立维护在 `extensions/chrome-kb/manifest.json`，当前为 0.15.10；含图标备份与共享同步需配套 kbcli 0.1.5+。提交前运行：

```bash
node --test tests/extension/*.test.mjs
uv run --locked pytest -q
python3 scripts/build_extension.py --output /path/to/new-release/chrome-kb
```

输出父目录中会同时生成 `chrome-kb-0.15.10.zip`，目录或同版本 ZIP 已存在时拒绝覆盖；重新构建使用新的输出父目录。构建器仅复制白名单资源并生成哈希清单，开发技能、测试 shim、配置和凭据不进入扩展包。Git 提交包含源码、测试、说明、截图和官方技能的来源/许可证；ZIP 与解压产物继续留在被忽略的 dist 目录中。

测试入口、隔离服务和真实点击场景见 [插件验证说明](../tests/extension/README.md)，本次 0.3.0–0.4.1 整理结果见 [提交验收](verification/chrome-0.4.1-release.md)。

当前测试包含 Chrome API 替身与隔离知识库服务，不等于原生扩展安装验收。首次安装、主机访问弹窗、本地网络访问和 worker 终止/恢复仍需真实 Chrome 验证，见 [插件审查记录](chrome-extension-audit.md)。

## 架构图维护

使用 archify，修改 `docs/architecture/*.architecture.json` 后重新 render、validate 和 check；在浏览器中检查布局、主题切换与导出，并同步更新同名 SVG、PNG。HTML 与静态预览必须来自同一份 JSON，不能只改截图。archify 是文档工具，不是 kbcli 运行依赖。

## GitHub 与部署

检查提交范围没有密钥、本机环境或知识内容，提交源码、测试、锁文件与文档后正常推送配置的分支。版本 tag 与 GitHub Release 在明确发布时单独创建；直接推送源码不代表产物已经上传到 Release 或 PyPI。

NAS 使用完整发布包或已安装软件，保留知识库和库外状态卷，配置本机令牌后启动服务。更新软件后重启并检查 version、doctor、状态、任务接口；数据同步成功不代表服务已更新。

## NAS 镜像构建

运行 `python3 scripts/build_nas_image_context.py --output /path/to/new/context` 生成凭据隔离的 Docker 上下文；在 NAS 使用其中 Dockerfile 构建本地版本镜像。镜像、目录迁移、凭据保留及回滚见 [NAS 部署](nas-deployment.md)。软件版本不变时，部署镜像可使用独立的 nas 后缀版本；已运行镜像的 digest 记录在验收文档中。

NAS 工具本轮提交范围与测试结果见 [2026-10-19 验收](verification/nas-release-2026-10-19.md)，执行入口见 [NAS 工具说明](../deploy/nas/README.md)。

## 浏览器备份发行

0.5.0 新增 alarms 权限，完整功能需要 kbcli 0.1.3，旧客户端读取和待办协议保持兼容。发布时必须先跑 `tests/test_backups.py`、`tests/extension/backup.test.mjs` 与 `verify_backups.mjs`，并使用新版 `verify_nas_image.py` 验证不可变 JSON 的操作日志、自动推送、另一副本读取、agent 拒绝与冲突持久暂停。镜像升级用 `activate_nas_image.py --expected-version 0.1.3`。备份内容不得包含真实凭据或打入发布包。部署及测试边界见[验收记录](verification/chrome-backups-0.5.0.md)。

0.6.0 共享同步需 kbcli 0.1.4，发布时增加 test_workspace.py、workspace.test.mjs 和 verify_workspace.mjs；先跑 NAS 隔离共享 CAS/保护备份验收，再用 activate_nas_image.py 的 `--expected-version 0.1.4` 切换镜像。

## 当前工作台验收（0.15.10）

当前版本使用 Orbit 居中文件夹/知识库/设置弹窗及本地 Motion 动效，支持单列知识列表、折叠目录、全屏阅读与首屏缓存。原有控件、备份、拖拽、检查及图标工具完整保留。各轮界面验证记录位于 design/，包含个人壁纸的本机 previews/*.png 不纳入 Git；正式扩展包仍由白名单构建。

0.15.10 移除管理模式并保留直接编辑、拖拽与键盘排序，首页文件夹改为固定紧凑卡片，新增本机通用收藏对齐偏好。验收见 design/kb-direct-folders/、design/kb-home-folders/，浏览器用例见 verify_direct_folders.mjs、verify_home_alignment.mjs。
