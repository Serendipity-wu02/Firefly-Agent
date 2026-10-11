import { describe, expect, it, vi } from "vitest";
import { fetchVendorModels, parseModelList, resolveModelsUrl } from "./fetch-vendor-models";

const json = (body: unknown, init: { status?: number } = {}) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "content-type": "application/json" } }));

describe("resolveModelsUrl", () => {
  it("appends /models for OpenAI-style endpoints and strips a pasted call path", () => {
    expect(resolveModelsUrl("https://api.openai.com/v1", "openai")).toBe("https://api.openai.com/v1/models");
    expect(resolveModelsUrl("https://proxy.test/v1/chat/completions/", "openai")).toBe("https://proxy.test/v1/models");
    expect(resolveModelsUrl("https://api.openai.com/v1/responses", "responses")).toBe("https://api.openai.com/v1/models");
  });

  it("uses /v1/models for Anthropic and does not double the version segment", () => {
    expect(resolveModelsUrl("https://api.anthropic.com", "anthropic")).toBe("https://api.anthropic.com/v1/models");
    expect(resolveModelsUrl("https://api.example.test/anthropic/v1", "anthropic")).toBe("https://api.example.test/anthropic/v1/models");
    expect(resolveModelsUrl("https://api.example.test/anthropic/v1/messages", "anthropic")).toBe("https://api.example.test/anthropic/v1/models");
  });
});

describe("parseModelList", () => {
  it("reads the OpenAI/Anthropic data array, keeps display names, drops blanks and duplicates", () => {
    expect(parseModelList({ data: [{ id: "m-1" }, { id: "m-2", display_name: "Model Two" }, { id: "m-1" }, { id: " " }, { nope: 1 }] }))
      .toEqual([{ id: "m-1" }, { id: "m-2", name: "Model Two" }]);
  });

  it("accepts the looser shapes some compatible endpoints return", () => {
    expect(parseModelList({ models: [{ name: "a" }, "b"] })).toEqual([{ id: "a" }, { id: "b" }]);
    expect(parseModelList(["x", "y"])).toEqual([{ id: "x" }, { id: "y" }]);
    expect(parseModelList(null)).toEqual([]);
    expect(parseModelList({ data: "nope" })).toEqual([]);
  });
});

describe("fetchVendorModels", () => {
  it("asks the connected vendor with the profile's key and returns its models", async () => {
    const fetchImpl = vi.fn((_url: string, _init?: RequestInit) => json({ data: [{ id: "gpt-x" }, { id: "gpt-y" }] }));
    const result = await fetchVendorModels(
      { provider: "ChatGPT（OpenAI）", baseUrl: "https://api.openai.com/v1", apiKey: "sk-test", explicitTransport: "responses" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result).toEqual({ ok: true, models: [{ id: "gpt-x" }, { id: "gpt-y" }] });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/models");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
  });

  it("sends the Anthropic version header on the Anthropic protocol", async () => {
    const fetchImpl = vi.fn((_url: string, _init?: RequestInit) => json({ data: [{ id: "claude-x", display_name: "Claude X" }] }));
    const result = await fetchVendorModels(
      { provider: "自定义", baseUrl: "https://api.example.test/anthropic", apiKey: "k", explicitTransport: "anthropic" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result).toEqual({ ok: true, models: [{ id: "claude-x", name: "Claude X" }] });
    const headers = fetchImpl.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["anthropic-version"]).toBeTruthy();
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.example.test/anthropic/v1/models");
  });

  it("reports what went wrong without touching the network when the profile is incomplete", async () => {
    const fetchImpl = vi.fn();
    expect(await fetchVendorModels({ provider: "p", baseUrl: "", apiKey: "k" }, { fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ ok: false, error: "MISSING_BASE_URL" });
    expect(await fetchVendorModels({ provider: "p", baseUrl: "https://x.test", apiKey: " " }, { fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ ok: false, error: "MISSING_API_KEY" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps HTTP, network and empty-answer failures to short codes that never echo the key", async () => {
    const base = { provider: "p", baseUrl: "https://x.test/v1", apiKey: "secret-key" };
    expect(await fetchVendorModels(base, { fetchImpl: (() => json({ error: "no" }, { status: 401 })) as unknown as typeof fetch })).toEqual({ ok: false, error: "HTTP_401" });
    expect(await fetchVendorModels(base, { fetchImpl: (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch })).toEqual({ ok: false, error: "NETWORK" });
    expect(await fetchVendorModels(base, { fetchImpl: (() => json({ data: [] })) as unknown as typeof fetch })).toEqual({ ok: false, error: "BAD_RESPONSE" });
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(await fetchVendorModels(base, { fetchImpl: (() => Promise.reject(abort)) as unknown as typeof fetch })).toEqual({ ok: false, error: "TIMEOUT" });
  });
});
