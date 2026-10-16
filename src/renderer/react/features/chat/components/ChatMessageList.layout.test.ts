import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(resolve(__dirname, "ChatMessageList.css"), "utf8");

describe("chat reading width", () => {
  it("uses one responsive reading width for the run activity", () => {
    expect(stylesheet).toContain("--ff-message-reading-width: 100%");
    // 阅读宽度由 react-root.css 的 --ff-reading-width 决定，随窗口宽度自动调节，不再写死 770px
    expect(stylesheet).toMatch(/\.ff-message-list \.ant-bubble-list \{[^}]*max-width: var\(--ff-reading-width\);[^}]*margin-inline: auto;/);
    const root = readFileSync(resolve(__dirname, "../../../styles/react-root.css"), "utf8");
    expect(root).toMatch(/--ff-reading-width: clamp\(\d+px, \d+%, \d+px\);/);
    expect(stylesheet).toMatch(/\.ff-message--activity \{[\s\S]*width: var\(--ff-message-reading-width\)/);
  });

  it("keeps the chat column a fixed width while the right pane is open, so dragging the separator does not resize it", () => {
    const root = readFileSync(resolve(__dirname, "../../../styles/react-root.css"), "utf8");
    expect(root).toMatch(/\.ff-page-dock\.has-inspector \{[^}]*--ff-reading-width: clamp\(\d+px, 100%, \d+px\);/);
    const page = readFileSync(resolve(__dirname, "../pages/ChatPage.tsx"), "utf8");
    expect(page).toContain('" has-inspector"');
  });

  it("renders assistant answers as borderless text using the full chat width", () => {
    expect(stylesheet).toMatch(
      /\.ff-message--assistant \.ant-bubble-content \{[\s\S]*padding: 0[\s\S]*background: transparent[\s\S]*box-shadow: none/,
    );
    expect(stylesheet).toMatch(
      /\.ff-message--assistant \.ant-bubble-body \{[\s\S]*width: calc\(100% - 54px\)[\s\S]*max-width: calc\(100% - 54px\)/,
    );
    // 气泡开关已删除：不再存在按 dataset 切换的样式
    expect(stylesheet).not.toContain("data-assistant-bubble");
  });
});

describe("reference composer (open-claude-ui)", () => {
  const composer = readFileSync(resolve(__dirname, "ChatComposer.css"), "utf8");
  it("draws one 20px card with a three-state shadow", () => {
    expect(composer).toMatch(/\.ff-composer-shell \{\s*border: 0;\s*border-radius: 20px;/);
    expect(composer).toMatch(/\.ff-composer-shell:hover \{ box-shadow:/);
    expect(composer).toMatch(/\.ff-composer-shell:focus-within \{\s*box-shadow:/);
  });
  it("keeps the text area between 48px and 384px and lays the toolbar out start / end", () => {
    expect(composer).toMatch(/\.ff-composer \.ant-sender-input \{ min-height: 48px; max-height: 384px;/);
    expect(composer).toMatch(/\.ff-composer__toolbar \{[^}]*justify-content: space-between;/);
    expect(composer).toMatch(/\.ff-composer \.ant-sender-actions-btn:active:not\(:disabled\) \{ transform: scale\(0\.95\); \}/);
  });
});
