// 从用户接入的厂商 API 拉取模型清单，供设置页的"模型名"联想使用。
// 型号由厂商决定，不再只靠预设里写死的几个名字；拉不到时设置页仍回退到预设建议。
import type { ApiTransport } from "../../shared/api-endpoint";
import { authHeaderFor } from "../orchestrator/vendors/auth";
import { getCapabilityOrOpenAI } from "../orchestrator/vendors/capabilities";

export interface FetchModelsInput {
  provider: string;
  baseUrl: string;
  apiKey: string;
  explicitTransport?: ApiTransport;
}

export interface VendorModel {
  id: string;
  /** 厂商给出的展示名（如 Anthropic 的 display_name），没有就缺省。 */
  name?: string;
}

export type FetchModelsResult =
  | { ok: true; models: VendorModel[] }
  | { ok: false; error: "MISSING_BASE_URL" | "MISSING_API_KEY" | "NETWORK" | "TIMEOUT" | "BAD_RESPONSE" | `HTTP_${number}` };

const ANTHROPIC_VERSION = "2023-06-01";
const MAX_MODELS = 500;

/** 各协议的"模型列表"地址：去掉用户可能填成完整调用地址的后缀，再补 /models。 */
export function resolveModelsUrl(baseUrl: string, transport: ApiTransport): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "").replace(/\/(chat\/completions|responses|messages)$/, "");
  if (transport === "anthropic") return trimmed.endsWith("/v1") ? `${trimmed}/models` : `${trimmed}/v1/models`;
  return `${trimmed}/models`;
}

/** OpenAI / Anthropic 的 { data: [{ id }] }，以及少数兼容端点的 { models: [...] } / 纯数组。 */
export function parseModelList(body: unknown): VendorModel[] {
  const record = body && typeof body === "object" ? body as { data?: unknown; models?: unknown } : undefined;
  const list = Array.isArray(body) ? body : Array.isArray(record?.data) ? record.data : Array.isArray(record?.models) ? record.models : [];
  const seen = new Set<string>();
  const models: VendorModel[] = [];
  for (const item of list) {
    const entry = typeof item === "string" ? { id: item } : item as { id?: unknown; name?: unknown; display_name?: unknown } | null;
    const rawId = entry && typeof entry === "object" ? entry.id ?? entry.name : undefined;
    const id = typeof rawId === "string" ? rawId.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const display = entry && typeof entry === "object" && typeof entry.display_name === "string" ? entry.display_name.trim() : "";
    models.push(display && display !== id ? { id, name: display } : { id });
    if (models.length >= MAX_MODELS) break;
  }
  return models;
}

export async function fetchVendorModels(
  input: FetchModelsInput,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<FetchModelsResult> {
  const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim() : "";
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  if (!baseUrl) return { ok: false, error: "MISSING_BASE_URL" };
  if (!apiKey) return { ok: false, error: "MISSING_API_KEY" };

  const capability = getCapabilityOrOpenAI(input.provider);
  const transport: ApiTransport = input.explicitTransport ?? capability.transport;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...authHeaderFor(capability, apiKey, transport === "anthropic" ? "anthropic" : "openai"),
    ...(transport === "anthropic" ? { "anthropic-version": ANTHROPIC_VERSION } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(resolveModelsUrl(baseUrl, transport), { method: "GET", headers, signal: controller.signal });
    if (!response.ok) return { ok: false, error: `HTTP_${response.status}` };
    let body: unknown;
    try { body = await response.json(); } catch { return { ok: false, error: "BAD_RESPONSE" }; }
    const models = parseModelList(body);
    return models.length > 0 ? { ok: true, models } : { ok: false, error: "BAD_RESPONSE" };
  } catch (error) {
    return { ok: false, error: (error as { name?: string })?.name === "AbortError" ? "TIMEOUT" : "NETWORK" };
  } finally {
    clearTimeout(timer);
  }
}
