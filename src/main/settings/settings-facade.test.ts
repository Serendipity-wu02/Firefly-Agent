import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneralSettings } from "./general-settings";
import { normalizeGeneralSettings } from "./settings-facade";

const retiredMomentsSettings = {
  momentsEnabled: true,
  chatMomentsContextEnabled: true,
  fireflyMomentsPostingEnabled: true,
  fireflyMomentsReactionsEnabled: true,
  momentsCharacterReactionsEnabled: true,
  momentsLiveliness: "lively",
};

it("ignores retired Moments keys while preserving shared settings", () => {
  const shared = { chatSocialContextEnabled: true, asrEngine: "mossland",
    toolModeOverrides: { search_text: { work: true } }, skillModeOverrides: { tutoring: { work: true } } };
  const settings = normalizeGeneralSettings({ ...shared, ...retiredMomentsSettings } as never);
  expect(settings).toMatchObject(shared);
  for (const field of Object.keys(retiredMomentsSettings)) {
    expect(settings).not.toHaveProperty(field);
    expect(normalizeGeneralSettings({})).not.toHaveProperty(field);
  }
});

it("preserves retired skill overrides without rewriting existing user configuration", () => {
  const skillModeOverrides = { assessment: { work: false }, tutoring: { work: true }, "knowledge-workspace": { work: true } };
  expect(normalizeGeneralSettings({ skillModeOverrides })).toMatchObject({ skillModeOverrides });
});

it("ignores removed modes while preserving explicit Work overrides", () => {
  const settings = normalizeGeneralSettings({
    toolModeOverrides: { obsidian_edit: { learn: true, work: false }, obsidian_read_file: { learn: true } },
    skillModeOverrides: { study: { learn: true }, exam: { learn: true, work: false } },
  } as never);
  expect(settings.toolModeOverrides).toEqual({ obsidian_edit: { work: false } });
  expect(settings.skillModeOverrides).toEqual({ exam: { work: false } });
});

const electronMock = vi.hoisted(() => ({
  userDataDir: "",
}));

vi.mock("electron", () => ({
  app: {
    getPath: () => electronMock.userDataDir,
  },
}));

describe("general LSP settings", () => {
  it("keeps valid user server overrides and safely drops malformed settings", () => {
    const settings = normalizeGeneralSettings({
      lspServerOverrides: [
        { id: "python-pyright", command: "basedpyright-langserver", args: ["--stdio"] },
        { id: "python-pyright", command: "duplicate" },
        { id: "unknown-server", command: "not-allowed" },
        { id: "gopls", command: "  " },
        { id: "typescript-language-server", initializationOptions: { preferences: { includeCompletionsForModuleExports: true } }, constructor: "unsafe" },
      ] as unknown as GeneralSettings["lspServerOverrides"],
    });

    expect(settings.lspServerOverrides).toEqual([
      { id: "python-pyright", command: "basedpyright-langserver", args: ["--stdio"] },
      { id: "typescript-language-server", initializationOptions: { preferences: { includeCompletionsForModuleExports: true } } },
    ]);
  });

  it("loads older settings without requiring an LSP migration", () => {
    expect(normalizeGeneralSettings({}).lspServerOverrides).toEqual([]);
  });
});

describe("general run limit settings", () => {
  it("defaults to 200 rounds and 120 minutes, and 0 means unlimited", () => {
    const defaults = normalizeGeneralSettings({});
    expect(defaults.maxToolRounds).toBe(200);
    expect(defaults.runTimeoutMinutes).toBe(120);
    expect(normalizeGeneralSettings({ maxToolRounds: 0, runTimeoutMinutes: 0 } as never)).toMatchObject({ maxToolRounds: 0, runTimeoutMinutes: 0 });
  });
  it("clamps and rejects invalid values back to the defaults", () => {
    expect(normalizeGeneralSettings({ maxToolRounds: 99999 } as never).maxToolRounds).toBe(10_000);
    expect(normalizeGeneralSettings({ runTimeoutMinutes: 99999 } as never).runTimeoutMinutes).toBe(1440);
    expect(normalizeGeneralSettings({ maxToolRounds: -5, runTimeoutMinutes: "x" } as never)).toMatchObject({ maxToolRounds: 200, runTimeoutMinutes: 120 });
    expect(normalizeGeneralSettings({ maxToolRounds: 12.9 } as never).maxToolRounds).toBe(12);
    // null / 空串 / 空白不是「不限」：回到默认；只有明确的 0 才关闭限制。
    for (const blank of [null, "", "   "]) {
      expect(normalizeGeneralSettings({ maxToolRounds: blank, runTimeoutMinutes: blank } as never)).toMatchObject({ maxToolRounds: 200, runTimeoutMinutes: 120 });
    }
    expect(normalizeGeneralSettings({ maxToolRounds: "0", runTimeoutMinutes: "30" } as never)).toMatchObject({ maxToolRounds: 0, runTimeoutMinutes: 30 });
  });
});

describe("general Harness tool concurrency settings", () => {
  it("defaults to four and normalizes the configured safe range", () => {
    expect(normalizeGeneralSettings({}).maxParallelToolCalls).toBe(4);
    expect(normalizeGeneralSettings({ maxParallelToolCalls: 0 } as never).maxParallelToolCalls).toBe(1);
    expect(normalizeGeneralSettings({ maxParallelToolCalls: 99 } as never).maxParallelToolCalls).toBe(8);
    expect(normalizeGeneralSettings({ maxParallelToolCalls: 3.8 } as never).maxParallelToolCalls).toBe(3);
    expect(normalizeGeneralSettings({ maxParallelToolCalls: "invalid" } as never).maxParallelToolCalls).toBe(4);
  });
});

describe("general ASR settings", () => {
  it.each(["off", "aliyun", "mossland", "local"])("retires Call controls while preserving %s provider settings", (asrEngine) => {
    const shared = { asrEngine, asrAliyunAppKey: "fixture-app", asrAliyunAccessKeyId: "fixture-id",
      asrAliyunAccessKeySecret: "fixture-secret", asrLanguage: "en", asrMosslandKey: "fixture-shared-key" };
    const settings = normalizeGeneralSettings({ ...shared, asrVadSilenceMs: 1500, asrVadThreshold: 0.2, asrShowTranscript: true } as never);
    expect(settings).toMatchObject(shared);
    for (const field of ["asrVadSilenceMs", "asrVadThreshold", "asrShowTranscript"]) {
      expect(settings).not.toHaveProperty(field);
      expect(normalizeGeneralSettings({})).not.toHaveProperty(field);
    }
  });

  it("keeps Mossland as a supported ASR provider", () => {
    const settings = normalizeGeneralSettings({ asrEngine: "mossland" } as never);

    expect(settings.asrEngine).toBe("mossland");
  });
});

describe("tool switch persistence round trip (chatToolsEnabled + toolModeOverrides)", () => {
  beforeEach(() => {
    vi.resetModules();
    electronMock.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-settings-rt-"));
  });

  /** 模拟"重启"：resetModules 后重新 import，generalSettingsCache 归零、从磁盘重读 */
  async function importFresh() {
    return import("./settings-facade");
  }

  it("persists custom colors and reset across a settings-store reopen", async () => {
    const colors = { enabled: true, accent: "#123456", background: "#222222", foreground: "#eeeeee" };
    const first = await importFresh(); first.saveGeneralSettings({ uiColors: colors });
    vi.resetModules(); const reopened = await importFresh();
    expect(reopened.loadGeneralSettings().uiColors).toEqual(colors);
    reopened.saveGeneralSettings({ uiColors: { ...colors, enabled: false } });
    vi.resetModules(); expect((await importFresh()).loadGeneralSettings().uiColors.enabled).toBe(false);
  });

  it("consumes an installer login choice without rewriting retired settings", async () => {
    const settingsFile = path.join(electronMock.userDataDir, "app-settings.json");
    const saved = { ...retiredMomentsSettings, chatSocialContextEnabled: true, launchAtLogin: false };
    fs.writeFileSync(settingsFile, JSON.stringify(saved));
    fs.writeFileSync(path.join(electronMock.userDataDir, "installer-options.json"), '{"launchAtLogin":true}');
    const { loadGeneralSettings } = await importFresh();
    expect(loadGeneralSettings()).toMatchObject({ chatSocialContextEnabled: true, launchAtLogin: true });
    for (const field of Object.keys(retiredMomentsSettings)) expect(loadGeneralSettings()).not.toHaveProperty(field);
    expect(JSON.parse(fs.readFileSync(settingsFile, "utf8"))).toEqual({ ...saved, launchAtLogin: true });
  });

  it("ignores the removed GPU render switch left in an old settings file", async () => {
    const settingsFile = path.join(electronMock.userDataDir, "app-settings.json");
    fs.writeFileSync(settingsFile, JSON.stringify({ disableGpuElectron: true, chatSocialContextEnabled: true }));
    const { loadGeneralSettings } = await importFresh();
    expect(loadGeneralSettings()).not.toHaveProperty("disableGpuElectron");
    expect(loadGeneralSettings()).toMatchObject({ chatSocialContextEnabled: true });
  });

  it("reads retired settings without rewriting configuration or old Moments data", async () => {
    const settingsFile = path.join(electronMock.userDataDir, "app-settings.json");
    const original = JSON.stringify({ ...retiredMomentsSettings, chatSocialContextEnabled: true, asrEngine: "mossland" });
    fs.writeFileSync(settingsFile, original);
    const oldData = path.join(electronMock.userDataDir, "moments.json");
    fs.writeFileSync(oldData, "OLD_DATA_CANARY");
    const { loadGeneralSettings } = await importFresh();
    expect(loadGeneralSettings()).toMatchObject({ chatSocialContextEnabled: true, asrEngine: "mossland" });
    for (const field of Object.keys(retiredMomentsSettings)) expect(loadGeneralSettings()).not.toHaveProperty(field);
    expect(fs.readFileSync(settingsFile, "utf8")).toBe(original);
    expect(fs.readFileSync(oldData, "utf8")).toBe("OLD_DATA_CANARY");
  });

  it("keeps chatToolsEnabled and toolModeOverrides across a simulated restart", async () => {
    const { saveGeneralSettings } = await importFresh();
    // 首次开启 Chat 工具增强（ToolModePanel.toggleChatTools → saveGeneral）
    saveGeneralSettings({
      chatToolsEnabled: true,
      toolModeOverrides: { music_search: { chat: true }, weather: { chat: true } },
    });

    // 重启后读取
    const reloaded = await importFresh();
    const afterRestart = reloaded.loadGeneralSettings();
    expect(afterRestart.chatToolsEnabled).toBe(true);
    expect(afterRestart.toolModeOverrides).toEqual({
      music_search: { chat: true },
      weather: { chat: true },
    });

    // 逐工具开关（TOOL_SET_MODE_OVERRIDE handler → saveGeneral 合并写入）
    reloaded.saveGeneralSettings({
      toolModeOverrides: { ...afterRestart.toolModeOverrides, run_shell: { code: false } },
    });

    const third = await importFresh();
    const finalSettings = third.loadGeneralSettings();
    expect(finalSettings.toolModeOverrides).toEqual({
      music_search: { chat: true },
      weather: { chat: true },
      run_shell: { code: false },
    });
    expect(finalSettings.chatToolsEnabled).toBe(true);
  });

  it("toggling chatToolsEnabled off preserves the per-tool override records", async () => {
    const { saveGeneralSettings } = await importFresh();
    saveGeneralSettings({
      chatToolsEnabled: true,
      toolModeOverrides: { music_search: { chat: true } },
    });

    // 关闭总开关只写 chatToolsEnabled，不应清空 overrides
    const again = await importFresh();
    again.saveGeneralSettings({ chatToolsEnabled: false });

    const third = await importFresh();
    const finalSettings = third.loadGeneralSettings();
    expect(finalSettings.chatToolsEnabled).toBe(false);
    expect(finalSettings.toolModeOverrides).toEqual({ music_search: { chat: true } });
  });
});

it("keeps the interface language to zh-CN or en and falls back to zh-CN for anything else", () => {
  expect(normalizeGeneralSettings({}).language).toBe("zh-CN");
  expect(normalizeGeneralSettings({ language: "en" } as never).language).toBe("en");
  expect(normalizeGeneralSettings({ language: "ja" } as never).language).toBe("zh-CN");
  expect(normalizeGeneralSettings({ language: "ko" } as never).language).toBe("zh-CN");
});

it("ignores retired TTS settings while preserving text, ordinary audio preferences and internal channel ASR", () => {
  const settings = normalizeGeneralSettings({ttsEngine: "mossland", ttsAutoRead: true,
    ttsMosslandKey: "synthetic-existing-channel-key", asrEngine: "mossland", toastSoundEnabled: true} as never);
  expect(settings).not.toHaveProperty("ttsEngine");
  expect(settings).not.toHaveProperty("ttsAutoRead");
  expect(settings).not.toHaveProperty("ttsMosslandKey");
  expect(settings).toMatchObject({asrEngine: "mossland", asrMosslandKey: "synthetic-existing-channel-key", toastSoundEnabled: true});
});

it("normalizes valid custom colors and rejects malformed stored colors", () => {
  const colors = { enabled: true, accent: "#123456", background: "#ffffff", foreground: "#222222" };
  expect(normalizeGeneralSettings({ uiColors: colors }).uiColors).toEqual(colors);
  expect(normalizeGeneralSettings({ uiColors: { ...colors, accent: "url(secret)" } }).uiColors.accent).toBe("#0285ff");
});

describe("appearance typography settings", () => {
  beforeEach(() => {
    vi.resetModules();
    electronMock.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-settings-appearance-"));
  });

  it("defaults to the current real sizes and spacing", () => {
    expect(normalizeGeneralSettings({})).toMatchObject({
      chatLineHeight: 1.75,
      chatParaSpacing: 0.5,
      uiFontSize: 16,
      chatFontSize: 14,
      codeFontSize: 13,
    });
  });

  it("reads a legacy archive with the removed corner-radius fields without keeping them", () => {
    const settings = normalizeGeneralSettings({
      chatLineHeight: 1.6,
      windowCornerRadius: 30,
      uiThemeRadius: true,
    } as never);
    expect(settings).toMatchObject({ chatLineHeight: 1.6, chatFontSize: 14, codeFontSize: 13, uiFontSize: 16 });
    expect(settings).not.toHaveProperty("windowCornerRadius");
    expect(settings).not.toHaveProperty("uiThemeRadius");
  });

  it("clamps out-of-range sizes on normalize", () => {
    expect(normalizeGeneralSettings({ uiFontSize: 3, chatFontSize: 60, codeFontSize: 2, chatParaSpacing: 9 })).toMatchObject({
      uiFontSize: 12,
      chatFontSize: 22,
      codeFontSize: 11,
      chatParaSpacing: 1.2,
    });
  });

  it("persists the typography values across a settings-store reopen", async () => {
    const first = await import("./settings-facade");
    first.saveGeneralSettings({ uiFontSize: 18, chatFontSize: 99, codeFontSize: 12, chatParaSpacing: 0.9, chatLineHeight: 1.9 });
    vi.resetModules();
    const reopened = await import("./settings-facade");
    expect(reopened.loadGeneralSettings()).toMatchObject({
      uiFontSize: 18,
      chatFontSize: 22,
      codeFontSize: 12,
      chatParaSpacing: 0.9,
      chatLineHeight: 1.9,
    });
  });
});
