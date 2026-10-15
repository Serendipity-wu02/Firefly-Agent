# 插件在线目录的发布方式

应用启动插件市场时读取固定的一个目录文件，并只从固定前缀下载插件包。两者都写在 `src/main/plugin-marketplace.ts`，改动它们需要同时更新 `src/main/skills/external-boundary.test.ts` 里记录的文件哈希和断言。

| 内容 | 位置 |
|---|---|
| 目录 | 独立分支 `plugin-catalog` 上的 `marketplace/registry.json`，地址 `https://raw.githubusercontent.com/Serendipity-wu02/Firefly_Agent/plugin-catalog/marketplace/registry.json` |
| 插件包 | 本仓库 GitHub Release 资源，前缀 `https://github.com/Serendipity-wu02/Firefly_Agent/releases/download/`，每个包一个 tag，如 `text-stats-1.0.0` |

安全边界：目录里的每个条目都固定了包的 SHA-256，应用下载后不匹配就拒绝；重定向只允许 GitHub Release 资源的下载域；目录和包都有大小与超时上限；渲染端只能按插件 id 请求，拿不到地址。目录文件本身没有签名，所以能写 `plugin-catalog` 分支和 Release 的人等于能决定用户看到什么，权限应只给仓库所有者。签名留作后续。

## 发布一个新版本

1. 生成包和目录（只写本地文件，不联网）：

   ```powershell
   node scripts/plugin-marketplace/build.mjs --out-dir <目录> --repository Serendipity-wu02/Firefly_Agent --tag <tag> --registry-ref plugin-catalog
   ```

2. 用生成的 zip 建 Release：`gh release create <tag> <zip> --target <提交> --title ... --notes-file ...`。
3. 把生成的 `marketplace/registry.json` 提交到 `plugin-catalog` 分支。该分支只放这一个文件。
4. 核对：用应用的市场服务（真实网络）列出目录、下载并核对哈希，再确认应用里能看到插件。

首个发布：`text-stats 1.0.0`，SHA-256 `86a0baccb7ead506d1c2f2ab6925e2a4b5cba6ab6fa488f26a34fb0df388f43d`，与随应用的离线目录同一个包。
