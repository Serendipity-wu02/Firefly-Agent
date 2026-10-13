// channels settings-store 单元测试
// 重点验证 safeStorage encrypt/decrypt 边界 + 私有字段保存往返
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock electron 的 safeStorage（不需要真 keychain）
const encState = new Map<string, string>(); // plaintext → base64 密文
let encryptCalls = 0;
let decryptCalls = 0;

vi.mock("electron", () => {
  return {
    app: {
      getPath: (_k: string) => os.tmpdir(),
      isReady: () => true,
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (plain: string) => {
        encryptCalls++;
        const fake = Buffer.from("ENC(" + plain + ")").toString("base64");
        encState.set(plain, fake);
        return Buffer.from(fake, "base64");
      },
      decryptString: (buf: Buffer) => {
        decryptCalls++;
        const b64 = buf.toString("base64");
        // 反查明文
        for (const [plain, stored] of encState.entries()) {
          if (stored === b64) return plain;
        }
        throw new Error("mock decrypt failed");
      },
    },
  };
});

// 必须在 mock 后 import
// eslint-disable-next-line import/first
import { loadChannelsSettings, saveChannelsSettings } from "./settings-store";

describe("channels/settings-store", () => {
  beforeEach(() => {
    // 每个测试前清掉磁盘文件（如果存在）
    const p = path.join(os.tmpdir(), "channels-settings.json");
    if (fs.existsSync(p)) fs.unlinkSync(p);
    encState.clear();
    encryptCalls = 0;
    decryptCalls = 0;
  });

  it("发送者白名单: 新配置默认只放行白名单", () => {
    const cfg = loadChannelsSettings();
    expect(cfg.wechat).toMatchObject({ allowAnyPrivate: false, allowedSenderIds: [] });
    expect(cfg.feishu).toMatchObject({ allowAnyPrivate: false, allowedSenderIds: [] });
  });

  it("发送者白名单: 升级前已启用且无放行字段的渠道保持放行所有人", () => {
    const p = path.join(os.tmpdir(), "channels-settings.json");
    fs.writeFileSync(p, JSON.stringify({ wechat: { enabled: true }, feishu: { enabled: false } }));
    const cfg = loadChannelsSettings();
    expect(cfg.wechat.allowAnyPrivate).toBe(true);
    expect(cfg.feishu.allowAnyPrivate).toBe(false);
  });

  it("发送者白名单: 保存后固定为显式值，非法标识被丢弃", () => {
    const p = path.join(os.tmpdir(), "channels-settings.json");
    fs.writeFileSync(p, JSON.stringify({ wechat: { enabled: true } }));
    saveChannelsSettings({ wechat: { allowAnyPrivate: false, allowedSenderIds: ["a@im.wechat", "bad id", "a@im.wechat"] } as never });
    const cfg = loadChannelsSettings();
    expect(cfg.wechat.allowAnyPrivate).toBe(false);
    expect(cfg.wechat.allowedSenderIds).toEqual(["a@im.wechat"]);
    // 只改开关的补丁不会把已有白名单清空，也不会重新放开
    saveChannelsSettings({ wechat: { enabled: true } as never });
    expect(loadChannelsSettings().wechat).toMatchObject({ allowAnyPrivate: false, allowedSenderIds: ["a@im.wechat"] });
  });

  it("loadChannelsSettings: 不存在时返回默认值", () => {
    const cfg = loadChannelsSettings();
    expect(cfg.wechat.enabled).toBe(false);
    expect(cfg.feishu.enabled).toBe(false);
    expect(cfg.qq.enabled).toBe(false);
    expect(cfg.qq.port).toBe(6200);
    expect(cfg.rateLimitPerUser).toBe(10);
  });

  it("rejects an unsupported stored secret without replacing the original file", () => {
    const file = path.join(os.tmpdir(), "channels-settings.json");
    const original = JSON.stringify({ feishu: { appSecret: "plain:public-fixture" } });
    fs.writeFileSync(file, original);
    expect(() => loadChannelsSettings()).toThrow("CHANNELS_SETTINGS_READ_FAILED");
    expect(() => saveChannelsSettings({ feishu: { enabled: true } })).toThrow("CHANNELS_SETTINGS_READ_FAILED");
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });

  it("encrypts the QQ access token and normalizes numeric allowlists", () => {
    saveChannelsSettings({ qq: {
      enabled: true,
      listenMode: "wsl",
      port: 6200,
      accessToken: "qq-secret",
      allowedPrivateUserIds: [" 10001 ", "bad", "10001"],
      allowedGroupIds: ["20001"],
      groupRequireMention: true,
      groupReplyStyle: "reply-and-mention",
      groupToolPolicy: "off",
      groupMemoryPolicy: "shared-personal",
    } });
    const raw = fs.readFileSync(path.join(os.tmpdir(), "channels-settings.json"), "utf8");
    expect(raw).not.toContain("qq-secret");
    const loaded = loadChannelsSettings();
    expect(loaded.qq.accessToken).toBe("qq-secret");
    expect(loaded.qq.allowedPrivateUserIds).toEqual(["10001"]);
    expect(loaded.qq.allowedGroupIds).toEqual(["20001"]);
  });

  it("saveChannelsSettings + load: 私密字段加密落盘 + 解密还原", () => {
    saveChannelsSettings({
      feishu: {
        enabled: true,
        appId: "cli_test_001",
        appSecret: "my-super-secret",
      },
    });
    // 磁盘上应该是 enc: 前缀密文
    const raw = fs.readFileSync(path.join(os.tmpdir(), "channels-settings.json"), "utf8");
    expect(raw).not.toContain("my-super-secret"); // 明文不落盘
    expect(raw).toContain("cli_test_001"); // 公开字段明文
    expect(raw).toContain('"appSecret": "enc:'); // 私密字段已加密
    // 加载回来：明文还原
    const loaded = loadChannelsSettings();
    expect(loaded.feishu.appId).toBe("cli_test_001");
    expect(loaded.feishu.appSecret).toBe("my-super-secret");
  });

  it("saveChannelsSettings: 不传 secret 不覆盖已有值", () => {
    saveChannelsSettings({ feishu: { enabled: true, appSecret: "secret-1" } });
    // 第二次保存不传 secret
    saveChannelsSettings({ feishu: { enabled: false, appId: "cli_002" } });
    const loaded = loadChannelsSettings();
    expect(loaded.feishu.appSecret).toBe("secret-1"); // 保留
    expect(loaded.feishu.appId).toBe("cli_002");
    expect(loaded.feishu.enabled).toBe(false);
  });

  it("saveChannelsSettings: 传新 secret 覆盖", () => {
    saveChannelsSettings({ feishu: { enabled: true, appSecret: "old" } });
    saveChannelsSettings({ feishu: { enabled: true, appSecret: "new" } });
    const loaded = loadChannelsSettings();
    expect(loaded.feishu.appSecret).toBe("new");
  });

  it("defaults to chat only and keeps an explicit all", () => {
    expect(loadChannelsSettings().toolSandbox).toBe("off");
    fs.writeFileSync(path.join(os.tmpdir(), "channels-settings.json"), JSON.stringify({ toolSandbox: "all" }), "utf8");
    expect(loadChannelsSettings().toolSandbox).toBe("all");
    // an unknown value falls back to the safe default, never to full tool access
    fs.writeFileSync(path.join(os.tmpdir(), "channels-settings.json"), JSON.stringify({ toolSandbox: "everything" }), "utf8");
    expect(loadChannelsSettings().toolSandbox).toBe("off");
  });

  it("saveChannelsSettings: persists the off tool sandbox", () => {
    saveChannelsSettings({ toolSandbox: "off" });
    expect(loadChannelsSettings().toolSandbox).toBe("off");
  });

  it("migrates the removed safe-only mode to off without elevating permissions", () => {
    fs.writeFileSync(
      path.join(os.tmpdir(), "channels-settings.json"),
      JSON.stringify({ toolSandbox: "safe-only" }),
      "utf8",
    );

    expect(loadChannelsSettings().toolSandbox).toBe("off");
  });
});
