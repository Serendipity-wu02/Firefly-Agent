# 办公令牌契约与格式边界

以下 JSON 键名与包内文件名属于兼容接口：不得更改拼写，也不得推断别名。校验器接受一个 UTF-8 JSON 对象，并按稳定的分区顺序报告全部独立的字段错误。它只校验数据本身，不检查已安装字体、对比度、版式、权限或输出产物。

## 必填结构

| 字段 | 取值要求与校验规则 |
|---|---|
| `id` | 非空白字符串。包内文件分别使用 `business`、`academic`、`formal-cn`、`financial`。自定义 ID 不会向其他技能的加载器注册。 |
| `colors` | 对象，须包含 `primary`、`secondary`、`accent`、`background`、`surface`、`foreground`、`muted`、`border`。每个值必须恰为 `#RRGGBB`，十六进制字母大小写均可。不接受短格式、透明通道、空白字符或颜色名称。 |
| `fonts` | 对象，须包含 `cjk`、`latin`、`fallback`。每个值都是有序、非空的非空白字符串数组。应在目标运行环境中核实可用性与字形覆盖；不要依据此列表下载字体。 |
| `spacing` | 对象，须包含 `base`：有限的正数，不接受数字字符串或布尔值。它是共享的节奏值，不是页边距，也不是通用几何单位；目标流程需要显式换算为原生单位。 |
| `roles` | 对象，须包含 `table_header`、`input`、`formula`、`warning`、`success`。每个值为 `#RRGGBB`，或 `colors` 中一个已存在且自身合法的键名。不做大小写折叠，不允许链式引用。 |
| `chart_colors` | 非空数组，每项都是 `#RRGGBB`。顺序决定系列与颜色的对应关系；各输出之间应保持系列标签与顺序稳定。 |

缺失必填键属于错误；类型不符、null 与空字体列表同样是错误。`chart_colors` 为空时保留诊断文案 `chart_colors is required`。可选字段不会被删除或改写，也不能作为任何现行消费者支持它们的证据。本校验器不强制封闭的 schema，也不核验每一个可选字段。

## 语义用法

- `primary`：突出的标题与表头底色；用于填充时应搭配已核实对比度的浅色文字。
- `secondary`：辅助层级，不作为正文主色。
- `accent`：焦点、链接与需要强调的系列，不自动代表成功状态。
- `background` / `surface`：页面底色与表格等容器内的填充。
- `foreground` / `muted`：主要文字与次要文字；交付时需核对实际对比度。
- `border`：结构性分隔线，不能作为表示状态的唯一标记。
- `roles.table_header` 解析为表头填充色。`roles.input` / `roles.formula` 表示编辑来源，不表示财务表现。`roles.warning` / `roles.success` 是语义状态，同时需要文字或符号配合。

版式与内容应分开处理：页边距、字号、坐标、行高、数字格式与公式都不属于共享令牌。

## 当前消费者映射

### PDF（`pdf/scripts/make.py` 的 `apply_theme`）

加载器相对于自身脚本的位置解析包内主题，把 `id` 映射为 `theme_id`，并做如下颜色映射：

| 共享颜色 | PDF 令牌 |
|---|---|
| `accent` | `accent` |
| `surface` | `accent_lt` |
| `foreground` | `dark` |
| `muted` | `muted` |
| `background` | `page_bg`、`cover_fg` |
| `primary` | `cover_bg` |

它不替换 `body_text`、字体、图表色或间距。特别是，共享的 `fonts` 列表并不会注册字体，`foreground` 也不保证 PDF 中每一段文字都使用它。不要把这些字段改写为 PDF 专用的 schema。

### PowerPoint（`pptx-generator/scripts/theme-loader.js` 的 `loadTheme`）

| 共享颜色 | 加载器输出 |
|---|---|
| `primary` | `primary` |
| `foreground` | `secondary` |
| `accent` | `accent` |
| `surface` | `light` |
| `background` | `bg` |

加载器会去掉开头的 `#`，并把六位十六进制转为大写。共享的 `secondary`、字体、角色、图表与间距都不会被它读取。明确的字体与图表设置应交由目标技能完成；不要把成功读取色板误认为已生成 PPTX。

### Excel 与 Word

当前 XLSX 流程与 `write_word` 都没有自动读取共享令牌的机制。应在校验主题并检查目标文件或工具之后，只映射已支持的原生样式。

`write_excel.colors` 的推荐映射如下：把已解析的 `roles.table_header` 映射到 `headerFill`；对于这类深色表头主题，把 `background` 映射到 `headerFont`；`accent` 映射到 `headerBorder`；`surface` 映射到 `zebraFill`；`border` 映射到 `borderColor`。映射时去掉 `#` 并加上前缀 `FF`，即得到不透明的 `FFRRGGBB`。主题校验器不执行这一映射。这些覆盖项不作用于输入单元格、公式、字体或图表，那些需要通过 XLSX 工作流处理。共享角色中，输入保持 `#0000FF`、公式保持 `#000000`；跨表公式仍使用 XLSX 技能自己的 `00B050` 约定。

`write_word.style` 选择的是 `docx/styles/` 中的预设，共享主题 ID 与该目录不能互换。`write_pdf` 不提供共享主题参数。工具参数、模式限制与产物检查都以宿主实现为准，而非以本文档为准。

## 校验器结果

以从 `invoke_skill` 返回的 office-design 目录构造出的绝对脚本路径，加上绝对的主题文件路径来运行校验器。不要假定某个安装目录。

令牌合规时，向 stdout 输出 `{"status": "ok", "errors": []}` 并以 `0` 退出；令牌不合规时，向 stdout 输出 `{"status": "error", "errors": [...]}` 并以 `1` 退出；文件、UTF-8 或 JSON 解析失败时，向 stderr 输出错误报告并以 `2` 退出。校验过程不会规范化路径、修复令牌、修改输入或创建输出文件。

实现依据：Python 3.13 的 [JSON 解析](https://docs.python.org/3.13/library/json.html#json.loads) 与 [有限数判断](https://docs.python.org/3.13/library/math.html#math.isfinite)。上文的消费者映射取自随附的 Firefly 源码，而非通用格式库的能力。
