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

插件版本独立维护在 `extensions/chrome-kb/manifest.json`，当前为 0.2.1；配套 kbcli 服务为 0.1.2。提交前运行：

```bash
node --test tests/extension/*.test.mjs
uv run --locked pytest -q
python3 scripts/build_extension.py --output /path/to/new-release/chrome-kb
```

输出父目录中会同时生成 `chrome-kb-0.2.1.zip`，目录或同版本 ZIP 已存在时拒绝覆盖；重新构建使用新的输出父目录。构建器仅复制白名单资源并生成哈希清单，开发技能、测试 shim、配置和凭据不进入扩展包。Git 提交包含源码、测试、说明、截图和官方技能的来源/许可证；ZIP 与解压产物继续留在被忽略的 dist 目录中。

当前测试包含 Chrome API 替身与隔离知识库服务，不等于原生扩展安装验收。首次安装、主机访问弹窗、本地网络访问和 worker 终止/恢复仍需真实 Chrome 验证，见 [插件审查记录](chrome-extension-audit.md)。

## 架构图维护

使用 archify，修改 `docs/architecture/*.architecture.json` 后重新 render、validate 和 check；在浏览器中检查布局、主题切换与导出，并同步更新同名 SVG、PNG。HTML 与静态预览必须来自同一份 JSON，不能只改截图。archify 是文档工具，不是 kbcli 运行依赖。

## GitHub 与部署

检查提交范围没有密钥、本机环境或知识内容，提交源码、测试、锁文件与文档后正常推送配置的分支。版本 tag 与 GitHub Release 在明确发布时单独创建；直接推送源码不代表产物已经上传到 Release 或 PyPI。

NAS 使用完整发布包或已安装软件，保留知识库和库外状态卷，配置本机令牌后启动服务。更新软件后重启并检查 version、doctor、状态、任务接口；数据同步成功不代表服务已更新。
