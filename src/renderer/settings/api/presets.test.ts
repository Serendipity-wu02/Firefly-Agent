import { describe, expect, it } from "vitest";
import { MODEL_PRESETS } from "./presets";
import { getCapability } from "../../../main/orchestrator/vendors/capabilities";

describe("MODEL_PRESETS — OpenRouter 预设", () => {
  const preset = MODEL_PRESETS.find((item) => item.providerName === "OpenRouter");

  it("存在于预设列表，短名为 OpenRouter，且可选（不是 disabled、不是隐藏或自定义端点）", () => {
    expect(preset).toBeDefined();
    expect(preset).toMatchObject({ providerName: "OpenRouter", shortName: "OpenRouter" });
    expect(preset?.disabled).toBeFalsy();
    expect(preset?.hiddenInPresetList).toBeFalsy();
    expect(preset?.customEndpointMode).toBeUndefined();
  });

  it("Base URL 为 OpenRouter 官方 OpenAI 兼容地址，协议显式为 openai（不走 Responses）", () => {
    expect(preset?.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(preset?.transport).toBe("openai");
  });

  it("不预置任何型号 id，型号由“获取模型列表”拉取后选择", () => {
    expect(preset?.mainModels).toEqual([]);
  });

  it("与厂商能力表对齐：同名条目的 Base URL 与协议一致", () => {
    const capability = getCapability("OpenRouter");
    expect(capability?.baseUrl).toBe(preset?.baseUrl);
    expect(capability?.transport).toBe(preset?.transport);
  });
});
