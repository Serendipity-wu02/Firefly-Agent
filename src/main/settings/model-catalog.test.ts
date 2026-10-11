import { describe, expect, it } from "vitest";
import { addModelProfile, updateModelProfile, resolveDefaultModelProfile } from "./model-catalog";
import { normalizeModelSettings, getDefaultModelProfile, getPublicModelConfig, resolveModelSettingsProfile } from "./model-settings";
import { resolveCaptionVisionConfig } from "../orchestrator/image-router";

describe("model catalog", () => {
  it("preserves explicit specialist model routes while normalizing saved settings", () => {
    const normalized = normalizeModelSettings({
      agentModelProfiles: { coding: "saved-code", research: "saved-research" },
    });
    expect(normalized.agentModelProfiles).toEqual({ coding: "saved-code", research: "saved-research" });
    expect(normalizeModelSettings(normalized).agentModelProfiles).toEqual(normalized.agentModelProfiles);
    expect(normalizeModelSettings({}).agentModelProfiles).toEqual({});
  });

  it("keeps the first saved model as the default and rejects a duplicate key plus model", () => {
    const first = addModelProfile([], {
      id: "openai-1",
      provider: "ChatGPT（OpenAI）",
      displayName: "我的 GPT",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-same",
      model: "gpt-5.6",
      explicitTransport: "openai",
    });

    expect(first.added).toBe(true);
    expect(resolveDefaultModelProfile(first.profiles, undefined)?.id).toBe("openai-1");

    const duplicate = addModelProfile(first.profiles, {
      ...first.profiles[0],
      id: "openai-2",
      displayName: "重复项",
    });

    expect(duplicate.added).toBe(false);
    expect(duplicate.profiles).toHaveLength(1);
  });

  it("allows the same key and model on a different baseUrl (官方 API + 中转站共存)", () => {
    const official = addModelProfile([], {
      id: "glm-official",
      provider: "GLM（智谱）",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKey: "sk-same",
      model: "glm-4.7",
    });
    const relay = addModelProfile(official.profiles, {
      id: "glm-relay",
      provider: "GLM（智谱）",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "sk-same",
      model: "glm-4.7",
    });

    expect(relay.added).toBe(true);
    expect(relay.profiles).toHaveLength(2);
  });

  it("updates a profile in place by id without dedup interference", () => {
    const base = [{
      id: "glm-1",
      provider: "GLM（智谱）",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKey: "sk-old",
      model: "glm-4.7",
    }];
    const updated = updateModelProfile(base, {
      id: "glm-1",
      provider: "GLM（智谱）",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKey: "sk-new",
      model: "glm-4.7",
      displayName: "GLM 官方",
      contextWindowTokens: 128000,
    });

    expect(updated).toHaveLength(1);
    expect(updated?.[0]).toMatchObject({ apiKey: "sk-new", displayName: "GLM 官方", contextWindowTokens: 128000 });

    expect(updateModelProfile(base, { id: "missing", provider: "GLM（智谱）", baseUrl: "", apiKey: "", model: "" })).toBeNull();
  });

  it("keeps saved credentials unverified before an explicit connection test", () => {
    const settings = normalizeModelSettings({
      provider: "ChatGPT（OpenAI）",
      apiKey: "",
      model: "",
      modelProfiles: [{
        id: "saved-model",
        provider: "ChatGPT（OpenAI）",
        displayName: "我的模型",
        apiKey: "sk-saved",
        model: "gpt-5.6",
        baseUrl: "https://api.openai.com/v1",
      }],
    });
    expect(getPublicModelConfig(settings).connected).toBe(false);
  });

  it("does not manufacture a saved profile from a top-level view", () => {
    const settings = normalizeModelSettings({
      provider: "ChatGPT（OpenAI）",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-existing",
      model: "gpt-5.6",
    });

    expect(getDefaultModelProfile(settings)).toBeUndefined();
  });

  it("preserves provider settings without manufacturing catalog entries", () => {
    const input = {
      provider: "GLM（智谱）",
      perProvider: {
        "GLM（智谱）": { baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "sk-glm", model: "glm-4.7" },
        "DeepSeek（深度求索）": { baseUrl: "https://api.deepseek.com", apiKey: "sk-ds", model: "deepseek-chat" },
        "Kimi（月之暗面）": { baseUrl: "https://api.moonshot.cn/v1", apiKey: "", model: "kimi-k2" }, // 无 Key 跳过
      },
    };

    const first = normalizeModelSettings(input);
    expect(first.modelProfiles).toHaveLength(0);
    expect(first.perProvider["GLM（智谱）"].model).toBe("glm-4.7");
    const second = normalizeModelSettings(first);
    expect(second.modelProfiles).toHaveLength(0);
  });

  it("does not resurrect profiles from perProvider after the user cleared the catalog", () => {
    const settings = normalizeModelSettings({
      provider: "GLM（智谱）",
      perProvider: {
        "GLM（智谱）": { baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "sk-glm", model: "glm-4.7" },
      },
    });
    expect(settings.modelProfiles).toHaveLength(0);

    const cleared = normalizeModelSettings({ ...settings, modelProfiles: [] });
    expect(cleared.modelProfiles).toHaveLength(0);
  });

  it("resolves profile-scoped context window and infers multimodal from each profile's model", () => {
    const settings = normalizeModelSettings({
      provider: "GLM（智谱）",
      contextWindowTokens: 256000,
      modelProfiles: [
        { id: "p-full", provider: "GLM（智谱）", baseUrl: "https://a.com", apiKey: "k", model: "glm-5v-turbo", contextWindowTokens: 128000 },
        { id: "p-inherited", provider: "GLM（智谱）", baseUrl: "https://b.com", apiKey: "k2", model: "glm-5.2" },
      ],
    });

    const full = resolveModelSettingsProfile(settings, "p-full");
    expect(full.contextWindowTokens).toBe(128000);
    expect(full.multimodal).toBe(true);

    const inheritedProfile = resolveModelSettingsProfile(settings, "p-inherited");
    expect(inheritedProfile.contextWindowTokens).toBe(256000);
    expect(inheritedProfile.multimodal).toBe(false);

    // 旧存档里的 multimodal 字段不再决定能力：纯文本型号即使写了 true 也判为不支持图片
    const stale = normalizeModelSettings({ provider: "GLM（智谱）", model: "glm-5.2", multimodal: true });
    expect(stale.multimodal).toBe(false);

    // 档案展开 + 图片路由：顶层空壳 provider 不再把多模态主模型误判为"看不了图"
    const shellSettings = normalizeModelSettings({
      provider: "MiniMax",
      baseUrl: "",
      apiKey: "",
      model: "",
      modelProfiles: [{
        id: "glm-default",
        provider: "GLM（智谱）",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: "sk-glm",
        model: "glm-5v-turbo",
      }],
      defaultModelProfileId: "glm-default",
    });
    expect(resolveCaptionVisionConfig(resolveModelSettingsProfile(shellSettings))).toEqual({
      ok: true,
      config: {
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: "sk-glm",
        model: "glm-5v-turbo",
      },
    });

    // 纯文本型号：档案展开后拒绝看图，不再回退到全局视觉模型
    const textSettings = normalizeModelSettings({
      provider: "MiniMax",
      modelProfiles: [{
        id: "text-model",
        provider: "MiniMax",
        apiKey: "sk-main",
        model: "MiniMax-M2.7",
        baseUrl: "https://api.minimaxi.com/v1",
      }],
      defaultModelProfileId: "text-model",
    });
    expect(resolveCaptionVisionConfig(resolveModelSettingsProfile(textSettings)).ok).toBe(false);

    // 未传 id → 展开默认档案（第一个建档项 p-full），不再退回顶层镜像
    const defaultResolved = resolveModelSettingsProfile(settings, undefined);
    expect(defaultResolved.contextWindowTokens).toBe(128000);
    expect(defaultResolved.multimodal).toBe(true);
    expect(defaultResolved.baseUrl).toBe("https://a.com");
  });


  it("cleans invalid profile-scoped fields back to undefined", () => {
    const settings = normalizeModelSettings({
      provider: "GLM（智谱）",
      modelProfiles: [
        {
          id: "p-bad",
          provider: "GLM（智谱）",
          baseUrl: "https://a.com",
          apiKey: "k",
          model: "m",
          contextWindowTokens: 100, // 低于 4096 下限 → 清洗为 undefined
          multimodal: "yes", // 非布尔 → 清洗为 undefined
        } as never,
      ],
    });
    expect(settings.modelProfiles?.[0].contextWindowTokens).toBeUndefined();
    expect(settings.modelProfiles?.[0]).not.toHaveProperty("multimodal");
  });
});
