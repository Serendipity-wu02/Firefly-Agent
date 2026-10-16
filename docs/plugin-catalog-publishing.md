# 插件在线目录的发布方式

应用启动插件市场时读取固定的一个目录文件，并只从固定前缀下载插件包。两者都写在 `src/main/plugin-marketplace.ts`，改动它们需要同时更新 `src/main/skills/external-boundary.test.ts` 里记录的文件哈希和断言。

| 内容 | 位置 |
|---|---|
| 目录 | 独立分支 `plugin-catalog` 上的 `marketplace/registry.json`，地址 `https://raw.githubusercontent.com/Serendipity-wu02/Firefly_Agent/plugin-catalog/marketplace/registry.json` |
| 插件包 | 本仓库 GitHub Release 资源，前缀 `https://github.com/Serendipity-wu02/Firefly_Agent/releases/download/`，每个包一个 tag，如 `text-stats-1.0.0` |

安全边界：目录里的每个条目都固定了包的 SHA-256，应用下载后不匹配就拒绝；重定向只允许 GitHub Release 资源的下载域；目录和包都有大小与超时上限；渲染端只能按插件 id 请求，拿不到地址。目录文件本身没有签名，所以能写 `plugin-catalog` 分支和 Release 的人等于能决定用户看到什么，权限应只给仓库所有者。签名留作后续。

## 目录里的插件

随应用的离线目录和在线目录由同一份源码生成：`scripts/plugin-marketplace/build.mjs` 里的 `CATALOG_PLUGIN_IDS`，每个插件一个目录 `examples/<id>/`（`manifest.json`、`index.cjs`、`README.md`、`LICENSE`，以及只用于目录条目的 `catalog.json`，不进入 ZIP）。ZIP 的生成是确定的：同样的源码在任何目录、时区下得到相同的字节和 SHA-256。

| 插件 | 版本 | Release tag | ZIP SHA-256 | 在线状态 |
|---|---|---|---|---|
| `text-stats` | 1.0.0 | `text-stats-1.0.0` | `86a0baccb7ead506d1c2f2ab6925e2a4b5cba6ab6fa488f26a34fb0df388f43d` | 已发布 |
| `json-tools` | 1.0.0 | `json-tools-1.0.0` | `1057ed4187b5f629e82ba529cef8576543ba80cc3ae386dab845388ff7297e19` | 待发布 |
| `timezone-tools` | 1.0.0 | `timezone-tools-1.0.0` | `25e187eae08f74c92f0f95b8a298bdfab0fc79e2ed539a6090b027a9195ca60c` | 待发布 |
| `code-language` | 1.0.0 | `code-language-1.0.0` | `fc276e17cf53f26e92604ea90216fb6936c204a8d4f2f83aa5b82f2909b9feb3` | 待发布 |
| `text-trim` | 1.0.0 | `text-trim-1.0.0` | `4140f86be012659c49b725abebc428b6dc7dae84297ccc50fde6c4486df7913a` | 待发布 |

后四个改编自 deepseek-harness（MIT），各自的 README 和随包 LICENSE 记录了来源和版权声明。`text-stats 1.0.0` 的字节不得再变：线上目录已经固定了它的哈希，测试会拦截任何漂移；要改它必须升版本号。

## 发布一个新版本

1. 在合并后的提交上生成包和目录（只写本地文件，不联网）。不传 `--tag` 时，每个插件使用自己的 tag `<id>-<version>`，与已发布的 `text-stats-1.0.0` 一致：

   ```powershell
   node scripts/plugin-marketplace/build.mjs --out-dir <目录> --repository Serendipity-wu02/Firefly_Agent --registry-ref plugin-catalog
   ```

   命令会逐个打印 ZIP 路径和 SHA-256，核对它们与上表一致；`<目录>/marketplace/registry.json` 里 `text-stats` 的条目应与线上现有条目逐字相同。`<目录>/marketplace-config.json` 只是核对用的 URL 记录，不要用它覆盖应用配置。
2. **先**为每个待发布的插件建 Release，再动目录分支，避免目录指向尚不存在的资源。`text-stats` 已经发布，不要重建：

   ```powershell
   gh release create json-tools-1.0.0 <目录>/json-tools-1.0.0.zip --repo Serendipity-wu02/Firefly_Agent --target <合并后的提交 SHA> --title "JSON tools 1.0.0 (plugin package)" --notes "Offline JSON validation and structural comparison. Adapted from deepseek-harness (MIT). SHA-256 1057ed41..."
   ```

   对 `timezone-tools-1.0.0`、`code-language-1.0.0`、`text-trim-1.0.0` 重复同样的命令（各自的 ZIP、标题和哈希）。
3. 逐个确认 Release 资源可下载且哈希与上表一致：

   ```powershell
   gh release download json-tools-1.0.0 --repo Serendipity-wu02/Firefly_Agent --pattern "*.zip" --dir <核对目录>
   (Get-FileHash <核对目录>\json-tools-1.0.0.zip -Algorithm SHA256).Hash
   ```
4. 把生成的 `marketplace/registry.json` 提交到 `plugin-catalog` 分支（该分支只放这一个文件，五个条目全部在内）。
5. 核对：用应用的市场服务（真实网络）列出目录，确认五个插件都显示，安装其中一个并确认哈希核对通过、安装后保持停用。
