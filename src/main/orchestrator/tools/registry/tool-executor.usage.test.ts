import { describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ recordSkillUse: vi.fn() }));
vi.mock("../../../token-usage-store", () => store);

import { executeToolDefinition } from "./tool-executor";
import type { ToolDefinition } from "./tool-registry";

const tool = (id: string): ToolDefinition => ({ id, name: id, description: id, enabled: true, inputSchema: { type: "object", properties: {} }, execute: async () => "ok" });

describe("skill use counting", () => {
  it("counts an invoke_skill call where every dispatch path passes, whichever skill it names", async () => {
    store.recordSkillUse.mockClear();
    await executeToolDefinition(tool("invoke_skill"), { skill_id: "code-review" });
    expect(store.recordSkillUse).toHaveBeenCalledExactlyOnceWith("code-review");
  });

  it("ignores other tools and an invoke_skill call without a skill id", async () => {
    store.recordSkillUse.mockClear();
    await executeToolDefinition(tool("read_file"), { skill_id: "code-review" });
    await executeToolDefinition(tool("invoke_skill"), {});
    await executeToolDefinition(tool("invoke_skill"), { skill_id: 3 });
    expect(store.recordSkillUse).not.toHaveBeenCalled();
  });
});
