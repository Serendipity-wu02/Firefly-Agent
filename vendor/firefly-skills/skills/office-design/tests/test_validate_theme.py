"""validate_theme 的回归测试：只覆盖令牌契约，不依赖四套主题的具体取值。"""
from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from validate_theme import validate_theme  # noqa: E402


def sample_theme() -> dict:
    """一份刻意与随包主题不同的最小合规令牌。"""
    return {
        "id": "fixture",
        "colors": {
            "primary": "#203040",
            "secondary": "#507090",
            "accent": "#B05020",
            "background": "#F4F1EA",
            "surface": "#FFFFFF",
            "foreground": "#1F1F24",
            "muted": "#6E6E78",
            "border": "#CFD3D8",
        },
        "fonts": {"cjk": ["SimSun"], "latin": ["Calibri"], "fallback": ["Arial"]},
        "spacing": {"base": 6},
        "roles": {
            "table_header": "primary",
            "input": "#0000FF",
            "formula": "#000000",
            "warning": "#B45309",
            "success": "#166534",
        },
        "chart_colors": ["#507090", "#B05020", "#6E6E78"],
    }


def mutated(change) -> list[str]:
    theme = copy.deepcopy(sample_theme())
    change(theme)
    return validate_theme(theme)


class ThemeContractTests(unittest.TestCase):
    def test_compliant_tokens_produce_no_errors(self) -> None:
        self.assertEqual(validate_theme(sample_theme()), [])

    def test_missing_color_key_is_named(self) -> None:
        errors = mutated(lambda t: t["colors"].pop("accent"))
        self.assertIn("colors.accent is required", errors)

    def test_empty_chart_palette_is_rejected(self) -> None:
        errors = mutated(lambda t: t.update(chart_colors=[]))
        self.assertIn("chart_colors is required", errors)

    def test_role_may_reference_a_color_key(self) -> None:
        self.assertEqual(mutated(lambda t: t["roles"].update(warning="accent")), [])

    def test_unknown_role_reference_is_rejected(self) -> None:
        errors = mutated(lambda t: t["roles"].update(warning="not-a-color-key"))
        self.assertTrue(any(e.startswith("roles.warning") for e in errors), errors)

    def test_malformed_hex_is_rejected(self) -> None:
        for bad in ("#12345", "#GGGGGG", "123456", "#1234567", " #123456"):
            with self.subTest(value=bad):
                errors = mutated(lambda t, v=bad: t["colors"].update(primary=v))
                self.assertTrue(any(e.startswith("colors.primary") for e in errors), errors)

    def test_font_lists_must_hold_real_names(self) -> None:
        for bad in ([], [""], ["  "], "SimSun"):
            with self.subTest(value=bad):
                errors = mutated(lambda t, v=bad: t["fonts"].update(latin=v))
                self.assertTrue(any(e.startswith("fonts.latin") for e in errors), errors)

    def test_spacing_base_must_be_positive_and_finite(self) -> None:
        for bad in (0, -4, float("inf"), float("nan"), "8"):
            with self.subTest(value=bad):
                errors = mutated(lambda t, v=bad: t["spacing"].update(base=v))
                self.assertTrue(any(e.startswith("spacing.base") for e in errors), errors)

    def test_every_problem_is_reported_in_one_pass(self) -> None:
        def break_many(theme: dict) -> None:
            theme["colors"].pop("muted")
            theme["fonts"].pop("cjk")
            theme["chart_colors"] = []

        errors = mutated(break_many)
        for expected in ("colors.muted is required", "fonts.cjk is required", "chart_colors is required"):
            self.assertIn(expected, errors)


if __name__ == "__main__":
    unittest.main()
