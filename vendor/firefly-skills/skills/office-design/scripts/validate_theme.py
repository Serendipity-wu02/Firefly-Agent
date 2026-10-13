"""只读校验办公主题令牌文件。

退出码：
  0  令牌全部合规，stdout 输出 {"status": "ok", "errors": []}
  1  令牌不合规，stdout 输出全部独立错误
  2  文件不可读或不是 UTF-8 JSON，stderr 输出单条错误

脚本不修改、不修复输入文件，也不创建任何输出。
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

# 必填分区与其键。分区顺序决定错误输出顺序，修改前需同步测试预期。
REQUIRED_FIELDS: dict[str, tuple[str, ...]] = {
    "colors": ("primary", "secondary", "accent", "background", "surface", "foreground", "muted", "border"),
    "fonts": ("cjk", "latin", "fallback"),
    "spacing": ("base",),
    "roles": ("table_header", "input", "formula", "warning", "success"),
}

# 各分区的错误文案，{label} 为 "分区.键"。
FIELD_MESSAGES: dict[str, str] = {
    "colors": "{label} must be #RRGGBB",
    "fonts": "{label} must be a nonempty array of nonblank strings",
    "spacing": "{label} must be a finite positive number",
    "roles": "{label} must be #RRGGBB or an existing colors key",
}

_HEX_DIGITS = frozenset("0123456789abcdefABCDEF")


def _is_hex_color(candidate: Any) -> bool:
    """严格的 #RRGGBB：恰好 7 个字符，大小写十六进制均可，不含空白或透明度。"""
    if not isinstance(candidate, str) or len(candidate) != 7 or candidate[0] != "#":
        return False
    return all(char in _HEX_DIGITS for char in candidate[1:])


def _is_font_list(candidate: Any) -> bool:
    if not isinstance(candidate, list) or not candidate:
        return False
    return all(isinstance(name, str) and name.strip() != "" for name in candidate)


def _is_positive_finite(candidate: Any) -> bool:
    # type() 精确比较，因此 bool 与字符串数字都会被拒绝。
    if type(candidate) not in (int, float):
        return False
    if isinstance(candidate, float) and not math.isfinite(candidate):
        return False
    return candidate > 0


def _is_role_value(candidate: Any, palette: dict[str, Any]) -> bool:
    """角色值可以是直接颜色，也可以是 colors 中已存在且合规的键名（不做大小写折叠）。"""
    if _is_hex_color(candidate):
        return True
    return isinstance(candidate, str) and candidate in palette and _is_hex_color(palette[candidate])


def _value_is_valid(section: str, value: Any, palette: dict[str, Any]) -> bool:
    if section == "colors":
        return _is_hex_color(value)
    if section == "fonts":
        return _is_font_list(value)
    if section == "spacing":
        return _is_positive_finite(value)
    return _is_role_value(value, palette)


def _identifier_problems(theme: dict[str, Any]) -> list[str]:
    if "id" not in theme:
        return ["id is required"]
    identifier = theme["id"]
    if not isinstance(identifier, str) or identifier.strip() == "":
        return ["id must be a nonblank string"]
    return []


def _chart_problems(theme: dict[str, Any]) -> list[str]:
    if "chart_colors" not in theme or theme["chart_colors"] == []:
        return ["chart_colors is required"]
    series = theme["chart_colors"]
    if not isinstance(series, list) or not series or not all(_is_hex_color(item) for item in series):
        return ["chart_colors must be a nonempty array of #RRGGBB colors"]
    return []


def validate_theme(theme: Any) -> list[str]:
    """返回全部独立错误；空列表表示通过。不修改传入对象。"""
    if not isinstance(theme, dict):
        return ["theme must be an object"]

    problems = _identifier_problems(theme)

    palette = theme.get("colors")
    if not isinstance(palette, dict):
        palette = {}

    for section, keys in REQUIRED_FIELDS.items():
        if section not in theme:
            problems.append(f"{section} is required")
            continue
        block = theme[section]
        if not isinstance(block, dict):
            problems.append(f"{section} must be an object")
            continue
        for key in keys:
            label = f"{section}.{key}"
            if key not in block:
                problems.append(f"{label} is required")
            elif not _value_is_valid(section, block[key], palette):
                problems.append(FIELD_MESSAGES[section].format(label=label))

    problems.extend(_chart_problems(theme))
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Office theme tokens (read-only).")
    parser.add_argument("theme", type=Path, help="path to a UTF-8 encoded theme JSON file")
    arguments = parser.parse_args()

    try:
        document = json.loads(arguments.theme.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as failure:
        print(json.dumps({"status": "error", "errors": [str(failure)]}), file=sys.stderr)
        return 2

    problems = validate_theme(document)
    verdict = {"status": "error" if problems else "ok", "errors": problems}
    print(json.dumps(verdict, ensure_ascii=False))
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
