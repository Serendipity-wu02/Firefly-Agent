import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("reference composer (open-claude-ui)", () => {
  const composer = readFileSync(resolve(__dirname, "ChatComposer.css"), "utf8");
  it("draws one 20px card with a three-state shadow", () => {
    expect(composer).toMatch(/\.ff-composer-shell \{\s*border: 0;\s*border-radius: 20px;/);
    expect(composer).toMatch(/\.ff-composer-shell:hover \{ box-shadow:/);
    expect(composer).toMatch(/\.ff-composer-shell:focus-within \{\s*box-shadow:/);
  });
  it("keeps the text area between 56px and 384px and lays the toolbar out start / end", () => {
    expect(composer).toMatch(/\.ff-composer \.ant-sender-input \{ min-height: 56px; max-height: 384px;/);
    expect(composer).toMatch(/\.ff-composer__toolbar \{[^}]*justify-content: space-between;/);
    expect(composer).toMatch(/\.ff-composer \.ant-sender-actions-btn:active:not\(:disabled\) \{ transform: scale\(0\.95\); \}/);
  });
});
