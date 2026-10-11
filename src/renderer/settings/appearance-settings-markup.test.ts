import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)), "utf8");

function form(id: string): string {
  const match = html.match(new RegExp(`<form[^>]+id="${id}"[\\s\\S]*?</form>`));
  if (!match) throw new Error(`missing form ${id}`);
  return match[0];
}

describe("appearance settings markup", () => {
	  it("uses the Firefly settings navigation and panel identifiers", () => {
	    expect(html).toContain('data-section="firefly"');
	    expect(html).toContain('id="firefly-panel" data-panel="firefly"');
	    expect(form("firefly-panel")).toContain('id="firefly-save-status"');
	  });
	  it("adds appearance navigation and renames general settings", () => {
	    expect(html).toContain('data-section="appearance"');
	    expect(html).toContain('data-section="general"><span><svg class="nav-item__icon"');
	    expect(html).toContain('通用设置</span>');
	  });

	  it("contains the appearance groups and no placeholder options", () => {
    const panel = form("appearance-form");
    for (const heading of ["主题", "自定义", "字体", "高级", "流萤桌宠"]) {
      expect(panel).toContain(heading);
    }
    expect(panel).not.toContain("界面颜色");
    expect(panel).not.toContain("个性化");
    // Options that cannot be used are removed rather than shown disabled.
    expect(panel).not.toContain("SOON");
    expect(panel).not.toContain('class="appearance-placeholder"');
    expect(panel).not.toContain("单窗口");
    expect(panel).not.toContain("白调");
  });

  it("offers exactly the light and the dark Firefly theme, light selected by default", () => {
    const panel = form("appearance-form");
    expect(panel).toContain('id="ui-theme-select"');
    expect(panel).toContain('data-value="pearl-white"');
    expect(panel).toContain('data-value="firefly-dark"');
    expect(panel).toMatch(/class="appearance-theme-option is-active" data-value="pearl-white"/);
    expect(panel.match(/class="appearance-theme-option(?: is-active)?"/g)).toHaveLength(2);
  });

  it("offers only the Firefly desktop icon", () => {
    const panel = form("appearance-form");
    expect(panel).toContain('id="ui-icon-select"');
    expect(panel).toContain('data-icon="firefly"');
    expect(panel).not.toContain('data-icon="classic"');
  });

  it("does not expose unavailable theme choices", () => {
    const panel = form("appearance-form");
    expect(panel).not.toContain('data-theme="classic"');
    expect(panel).not.toContain('data-theme="pearl-white"');
    expect(panel).not.toContain('data-theme="polished-pink"');
  });

  it("keeps retired custom style and default-mode controls out of preferences", () => {
    const panel = form("preferences-form");
    for (const id of [
      "custom-style-sampling-btn",
      "custom-style-prompt-btn",
      "default-chat-mode-select",
      "mobile-message-segmentation-select",
    ]) {
      expect(panel, id).not.toContain(`id="${id}"`);
    }
    expect(panel).toContain('id="segmented-output-select"');
    expect(panel).toContain('id="proactive-chat-select"');
    expect(panel).toContain('id="chat-social-context-enabled"');
  });

  it("no longer offers a window corner-radius control", () => {
    const panel = form("appearance-form");
    expect(panel).not.toContain("window-corner-radius");
    expect(panel).not.toContain("窗口圆角");
    expect(html).not.toContain("window-corner-radius");
  });

  it("offers a system/imported font select, the import and reset buttons", () => {
    const panel = form("appearance-form");
    expect(panel).toContain('id="ui-font-select"');
    expect(panel).toContain('value="default"');
    expect(panel).toContain('id="ui-font-custom-option"');
    expect(panel).toContain('id="ui-font-import"');
    expect(panel).toContain('id="ui-font-reset"');
  });

  it("puts the three font sizes in a collapsed advanced section with their ranges", () => {
    const panel = form("appearance-form");
    expect(panel).toMatch(/<details class="appearance-advanced" id="appearance-advanced">/);
    expect(panel).toMatch(/id="ui-font-size-input" type="number" min="12" max="20"/);
    expect(panel).toMatch(/id="chat-font-size-input" type="number" min="12" max="22"/);
    expect(panel).toMatch(/id="code-font-size-input" type="number" min="11" max="20"/);
    // The existing line and paragraph spacing sliders stay, inside the same advanced card.
    expect(panel).toMatch(/id="chat-line-height"[\s\S]*id="chat-para-spacing"/);
  });

  it("renders each custom color as a rounded pill with a swatch and an editable hex", () => {
    const panel = form("appearance-form");
    expect(panel.match(/class="ui-color-pill"/g)).toHaveLength(3);
    for (const key of ["accent", "background", "foreground"]) {
      expect(panel).toMatch(new RegExp(`<input type="color" id="ui-color-${key}" class="ui-color-dot"`));
      expect(panel).toMatch(new RegExp(`<input type="text" id="ui-color-${key}-hex" class="ui-color-hex"`));
    }
  });

  it("no longer offers an assistant bubble switch (borderless is the only mode)", () => {
    const panel = form("appearance-form");
    expect(panel).not.toContain('id="assistant-bubble-enabled"');
  });

  it("applies appearance changes without a save button", () => {
    const panel = form("appearance-form");
    expect(panel).toContain("修改后自动应用");
    expect(panel).not.toContain("保存外观设置");
  });

  it("offers chat social context as an existing capsule switch", () => {
    const panel = form("preferences-form");
    expect(panel).toContain("聊天上下文增强");
    expect(panel).toMatch(
      /class="switch"[\s\S]*?id="chat-social-context-enabled"[\s\S]*?class="switch__track"[\s\S]*?class="switch__thumb"/,
    );
  });

  it("moves desktop-pet controls out of general settings", () => {
    const appearance = form("appearance-form");
    const general = form("general-form");
    for (const id of ["pet-always-on-top", "pet-visible", "pet-zoom"]) {
      expect(appearance).toContain(`id="${id}"`);
      expect(general).not.toContain(`id="${id}"`);
    }
  });
});

it("includes real auto-applied custom color controls and reset in appearance", () => {
  const panel = form("appearance-form");
  for (const id of ["ui-colors-enabled", "ui-colors-reset", "ui-colors-status", "ui-color-accent", "ui-color-background", "ui-color-foreground"]) expect(panel).toContain(`id="${id}"`);
  // The enable switch is a card row, not a bare checkbox.
  expect(panel).toMatch(/<label class="setting-row">[\s\S]*?id="ui-colors-enabled"[\s\S]*?class="switch__track"/);
});
