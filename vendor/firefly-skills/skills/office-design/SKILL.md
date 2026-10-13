---
name: office-design
description: 在 Word、Excel、PDF、PowerPoint 之间统一颜色、字体与间距令牌，并对主题文件做只读校验。仅当多种格式必须保持一致的视觉语义时启用；只修改单一格式时直接交给对应技能。
license: MIT
metadata:
  version: '1.0'
  category: document-design
modes:
  - work
  - code
---

# 办公外观共享约定

本技能在生成多种办公文档之前，先对齐一套视觉词汇。它负责挑选与校验令牌，不负责创建文档、安装依赖或授予执行权限。内容、版式、编辑与产物核验仍归各格式技能所有。

## 动手前先确认

1. 明确输出格式、受众、语言，以及用户提供的品牌或机构规范。读取真实模板与现有样式，不凭经验推断字段名或字体是否可用。
2. 编辑既有文件时默认保留原有样式。除非用户明确要求改版，共享主题并不构成替换排版、公式、内容或源文件的理由。
3. 只有包内主题的用途与需求吻合时才选用它；需求没有指明主题时先询问用户。自定义令牌应放在已授权的工作区，而不是安装后的技能目录里。

| `assets/themes/` 下的文件 | 适用场景 |
|---|---|
| `business.json` | 无衬线报告：深蓝导航与表头色，青绿色强调，浅蓝灰表格底，次要文字保持可读。 |
| `academic.json` | 长篇研究：衬线字体优先，纸张色底，赭红色点缀，图表系列逐一标注。不是任何机构的模板。 |
| `formal-cn.json` | 中文通知与公文类文档：宋体为首选，黑体、微软雅黑为备选；深色文字，中性填充，红色仅作有限强调。不代表任何文档标准的合规认证。 |
| `financial.json` | 数字密集型工作：紧凑间距，输入与公式区分清楚，深色表头，提示与成功状态分开。绝不改动数字格式或公式。 |

四个主题都采用深色 `primary` 搭配浅色 `background`，因为当前 PDF 读取器用这一对颜色绘制封面底色与封面文字。字体列表只是偏好顺序，不代表字体已安装或覆盖所需字形，使用前需在目标运行环境中核实。图表必须配有标签或图案，不能只靠颜色表达含义。

## 本地定位与校验

通过 `invoke_skill` 调用 `office-design`。`$skillDir` 必须设为该结果中标注为 **Skill 本地目录（仅用于定位资源，不授权执行）** 的绝对路径；它是文本中的路径，而不是 JSON 字段。不得替换为仓库根目录、其他技能的目录或当前工作目录。每个新的 PowerShell 会话都要重新初始化这些变量。

在当前模式与授权允许执行的前提下，下面这个只读示例会校验包内的 business 主题：

```powershell
if (-not [System.IO.Path]::IsPathRooted($skillDir)) { throw 'Use the absolute directory returned by invoke_skill.' }
$scriptRoot = Join-Path $skillDir 'scripts'
$themePath = Join-Path $skillDir 'assets\themes\business.json'
python -B (Join-Path $scriptRoot 'validate_theme.py') $themePath
if ($LASTEXITCODE -ne 0) { throw 'Theme validation failed; do not apply this theme.' }
```

校验自定义主题时，把 `$themePath` 改为已核实的工作区绝对路径，但校验脚本仍须从 `$skillDir` 下调用。校验只读取文件并输出 JSON 报告，从不修复或改写文件。退出码 `0` 表示通过，`1` 表示令牌不合规，`2` 表示输入无法按 UTF-8 JSON 读取。报告中的每条错误都必须解决，不得悄悄换成另一个主题。若 Python 或执行工具不可用，应报告阻塞原因，不要安装软件，也不要宣称已完成校验。

## 各格式如何接入

下表只记录当前实现真正支持的部分，字段细节见 [token-schema.md](references/token-schema.md)。调用每个目标技能时，都要分别使用它自己返回的绝对目录来定位资源。

| 目标格式 | 当前实现支持的内容 |
|---|---|
| `pdf` | `scripts/make.py` 的 `--theme` 接受 `business`、`academic`、`formal-cn`、`financial`。`apply_theme` 只读取共享的**颜色**，不读取共享字体、角色、图表色板或间距；PDF 的排版与版式仍由 PDF 流程负责。 |
| `pptx-generator` | `scripts/theme-loader.js` 的 `loadTheme` 返回 `primary`、`secondary`、`accent`、`light`、`bg` 五个六位十六进制值（不含 `#`）。这里的 `secondary` 来自 **foreground**，而不是共享的 `secondary`。该加载器不生成幻灯片，也不应用字体。 |
| `xlsx` | 其视觉工作流会有意识地映射颜色与角色，没有自动的共享主题加载器。写入原生样式之前，需先把 `roles` 引用解析到 `colors`，并保留蓝色手工输入、黑色公式以及跨表公式的既有约定。 |
| `docx` | 原生样式与经核实的字体选择交由 docx 技能处理。宿主的 `write_word` 读取的是 `docx/styles/` 而非本主题，它接受的是 `style` 而不是共享主题参数。要实现共享外观，必须通过已授权的 DOCX 流程做显式的原生样式映射。 |

宿主只在**工作模式**下注册 `write_word`、`write_excel`、`write_pdf`，三者的 `effectKind` 均为 `mutation`。它们是简单的创建工具，不是通用的主题引擎。`write_excel` 接受 `style`，以及可选的 `colors` 覆盖项：`headerFill`、`headerFont`、`headerBorder`、`zebraFill`、`borderColor`（不透明 ARGB）；它不接受共享字体、角色或图表色板。`write_pdf` 没有主题或样式参数。宿主没有注册 PowerPoint 写入工具；只有依赖齐备时，才可使用 `pptx-generator` 所描述的、实际获准的本地流程。加载本技能不会授予上述任何工具或权限。

## 交付前的记录

记录主题路径与校验报告、每种格式实际消费的令牌、已核实的字体，以及尚未实现的映射。输出应另存为已授权的新文件，不得覆盖源文件。随后由各格式技能执行自身的结构与视觉检查：中日韩字形是否可读、表头对比度、图表标签、内容是否被裁切、公式是否未变、源文件内容是否保留。仅有令牌校验通过，并不构成产物或视觉验证的凭据。

维护状态与保留的历史许可证来源见 `NOTICE.md`。
