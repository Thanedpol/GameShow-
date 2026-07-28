import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/**
 * ชั้นกลางที่คุยกับ LLM ทุกเจ้า
 *
 * รองรับ 3 ผู้ให้บริการ:
 *   anthropic  — เรียกผ่าน @anthropic-ai/sdk (structured output ของ Claude)
 *   openrouter — HTTP ตรงไปที่ /api/v1/chat/completions (รูปแบบเดียวกับ OpenAI)
 *   ollama     — HTTP ตรงไปที่ /api/chat ของเครื่องที่รัน Ollama อยู่
 *
 * แบ่งความรับผิดชอบไว้ชัด:
 *   - "คีย์" อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น (env) ไม่เคยผ่าน client
 *   - "เลือกเจ้าไหน/โมเดลอะไร" ส่งมาจากหลังบ้านได้ เพราะไม่ใช่ความลับ
 *     แต่ต้องผ่าน allowlist + regex ก่อนเสมอ กัน client ยัดค่ามั่ว
 */

export type LlmProvider = "anthropic" | "openrouter" | "ollama";

export const LLM_PROVIDERS: LlmProvider[] = ["anthropic", "openrouter", "ollama"];

export const PROVIDER_LABEL: Record<LlmProvider, string> = {
  anthropic: "Anthropic (Claude)",
  openrouter: "OpenRouter",
  ollama: "Ollama (เครื่องตัวเอง)",
};

/** ใช้ตอนผู้ใช้ยังไม่เคยเลือกโมเดลของเจ้านั้น */
export const DEFAULT_MODEL: Record<LlmProvider, string> = {
  anthropic: "claude-opus-5",
  openrouter: "anthropic/claude-sonnet-4.5",
  ollama: "llama3.1",
};

/** รายชื่อสำรองตอนดึงจาก API ไม่ได้ (เช่นยังไม่มีคีย์) */
const FALLBACK_MODELS: Record<LlmProvider, string[]> = {
  anthropic: [
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-fable-5",
    "claude-haiku-4-5-20251001",
  ],
  openrouter: [],
  ollama: [],
};

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export function ollamaBaseUrl(): string {
  const raw = process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
  return raw.replace(/\/+$/, "");
}

// ────────────────────────────────────────────────────────────────────────────
// เลือกผู้ให้บริการ + โมเดล
// ────────────────────────────────────────────────────────────────────────────

export interface LlmChoice {
  provider: LlmProvider;
  model: string;
}

/** ค่าที่หลังบ้านส่งมาแนบกับ request ได้ — ไม่บังคับ */
export interface LlmChoiceInput {
  provider?: string;
  model?: string;
}

function isProvider(value: unknown): value is LlmProvider {
  return typeof value === "string" && (LLM_PROVIDERS as string[]).includes(value);
}

/**
 * ชื่อโมเดลมีได้แค่ตัวอักษร ตัวเลข และ . _ - / :
 * กันไม่ให้ client ยัด path หรือ header injection ผ่านชื่อโมเดล
 */
const MODEL_PATTERN = /^[\w.:\/-]{1,120}$/;

export function sanitizeModel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return MODEL_PATTERN.test(trimmed) ? trimmed : null;
}

/** ค่าตั้งต้นจาก env — ใช้เมื่อ client ไม่ได้ส่งอะไรมา */
export function envChoice(): LlmChoice {
  const provider = isProvider(process.env.LLM_PROVIDER?.trim())
    ? (process.env.LLM_PROVIDER!.trim() as LlmProvider)
    : "anthropic";
  return {
    provider,
    model: sanitizeModel(process.env.HINT_MODEL) ?? DEFAULT_MODEL[provider],
  };
}

/**
 * รวมค่าจาก env กับค่าที่หลังบ้านเลือกไว้
 *
 * ถ้า client ระบุ provider มาแต่ไม่ระบุโมเดล จะไม่หยิบ HINT_MODEL ของ env มาใช้
 * เพราะโมเดลของคนละเจ้าใช้ชื่อคนละแบบ (claude-opus-5 กับ llama3.1 สลับกันไม่ได้)
 */
export function resolveLlm(input?: LlmChoiceInput | null): LlmChoice {
  const fromEnv = envChoice();
  if (!input) return fromEnv;

  const provider = isProvider(input.provider) ? input.provider : fromEnv.provider;
  const model = sanitizeModel(input.model);
  if (model) return { provider, model };

  return {
    provider,
    model: provider === fromEnv.provider ? fromEnv.model : DEFAULT_MODEL[provider],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// สถานะความพร้อมของแต่ละเจ้า
// ────────────────────────────────────────────────────────────────────────────

export function anthropicKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY?.trim() || undefined;
}

export function openRouterKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY?.trim() || undefined;
}

/** Ollama ไม่ต้องใช้คีย์ ขอแค่มี URL — จะรู้ว่าต่อติดจริงไหมตอนกดทดสอบ */
export function isProviderReady(provider: LlmProvider): boolean {
  if (provider === "anthropic") return Boolean(anthropicKey());
  if (provider === "openrouter") return Boolean(openRouterKey());
  return true;
}

let cachedAnthropic: Anthropic | null = null;

export function getAnthropic(): Anthropic | null {
  const apiKey = anthropicKey();
  if (!apiKey) return null;
  if (!cachedAnthropic) cachedAnthropic = new Anthropic({ apiKey, maxRetries: 1 });
  return cachedAnthropic;
}

// ────────────────────────────────────────────────────────────────────────────
// แกะ JSON จากคำตอบ
// ────────────────────────────────────────────────────────────────────────────

export function parseJsonLoose<T>(raw: string): T | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}

function extractAnthropicText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * โมเดลนอก Claude ไม่ได้บังคับสคีมาเป๊ะเท่ากัน จึงย้ำสคีมาลงใน system prompt ด้วย
 * นอกเหนือจากพารามิเตอร์ structured output ของแต่ละเจ้า
 */
function withSchemaInstruction(system: string, schema: Record<string, unknown>): string {
  return [
    system,
    "",
    "รูปแบบคำตอบ (สำคัญมาก):",
    "- ตอบกลับเป็น JSON object ล้วน ๆ เท่านั้น ห้ามมีข้อความอื่นหรือ markdown code fence",
    "- ต้องตรงตาม JSON Schema นี้:",
    JSON.stringify(schema),
  ].join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// เรียกโมเดล
// ────────────────────────────────────────────────────────────────────────────

export interface LlmJsonOptions {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  /** ใช้ในบรรทัด log เวลาพัง จะได้รู้ว่ามาจากจุดไหน */
  tag: string;
  timeoutMs?: number;
}

export async function callLlmJson<T>(
  choice: LlmChoice,
  options: LlmJsonOptions,
): Promise<T | null> {
  const timeoutMs = options.timeoutMs ?? 40_000;
  try {
    if (choice.provider === "anthropic") {
      return await callAnthropicJson<T>(choice.model, options, timeoutMs);
    }
    if (choice.provider === "openrouter") {
      return await callOpenRouterJson<T>(choice.model, options, timeoutMs);
    }
    return await callOllamaJson<T>(choice.model, options, timeoutMs);
  } catch (error) {
    console.error(`[${options.tag}] เรียก ${choice.provider} ไม่สำเร็จ:`, describeError(error));
    return null;
  }
}

async function callAnthropicJson<T>(
  model: string,
  { system, prompt, schema, maxTokens, tag }: LlmJsonOptions,
  timeoutMs: number,
): Promise<T | null> {
  const client = getAnthropic();
  if (!client) return null;

  const message = await client.messages.create(
    {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { effort: "low", format: { type: "json_schema", schema } },
    },
    { timeout: timeoutMs },
  );

  if (message.stop_reason === "refusal") {
    console.warn(`[${tag}] Claude ปฏิเสธคำขอ:`, message.stop_details);
    return null;
  }
  if (message.stop_reason === "max_tokens") {
    console.warn(`[${tag}] คำตอบถูกตัดกลางคัน (max_tokens)`);
    return null;
  }
  return parseJsonLoose<T>(extractAnthropicText(message));
}

/**
 * OpenRouter ใช้รูปแบบเดียวกับ OpenAI chat completions
 * ส่ง response_format แบบ json_schema ไปก่อน ถ้าโมเดลนั้นไม่รองรับแล้วโดนปฏิเสธ
 * จะลองใหม่อีกรอบโดยไม่ส่ง response_format แล้วอาศัยสคีมาที่ฝังใน system prompt แทน
 */
async function callOpenRouterJson<T>(
  model: string,
  { system, prompt, schema, maxTokens, tag }: LlmJsonOptions,
  timeoutMs: number,
): Promise<T | null> {
  const key = openRouterKey();
  if (!key) return null;

  const messages = [
    { role: "system", content: withSchemaInstruction(system, schema) },
    { role: "user", content: prompt },
  ];

  const send = (structured: boolean) =>
    fetchJson<{ choices?: Array<{ message?: { content?: string } }> }>(
      `${OPENROUTER_BASE}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-Title": "Bai Jing Bai Lok",
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          ...(structured
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: { name: "result", strict: true, schema },
                },
              }
            : {}),
        }),
      },
      timeoutMs,
    );

  let data: { choices?: Array<{ message?: { content?: string } }> };
  try {
    data = await send(true);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status >= 500) throw error;
    console.warn(`[${tag}] ${model} ไม่รับ json_schema — ลองใหม่แบบไม่บังคับสคีมา`);
    data = await send(false);
  }

  return parseJsonLoose<T>(data.choices?.[0]?.message?.content?.trim() ?? "");
}

/** Ollama รับ JSON Schema ตรง ๆ ผ่านฟิลด์ format */
async function callOllamaJson<T>(
  model: string,
  { system, prompt, schema, maxTokens }: LlmJsonOptions,
  timeoutMs: number,
): Promise<T | null> {
  const data = await fetchJson<{ message?: { content?: string } }>(
    `${ollamaBaseUrl()}/api/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: schema,
        messages: [
          { role: "system", content: withSchemaInstruction(system, schema) },
          { role: "user", content: prompt },
        ],
        options: { num_predict: maxTokens },
      }),
    },
    timeoutMs,
  );

  return parseJsonLoose<T>(data.message?.content?.trim() ?? "");
}

// ────────────────────────────────────────────────────────────────────────────
// ดึงรายชื่อโมเดล (ใช้ในหลังบ้าน)
// ────────────────────────────────────────────────────────────────────────────

export interface ModelOption {
  id: string;
  label: string;
}

export async function listModels(provider: LlmProvider): Promise<ModelOption[]> {
  try {
    if (provider === "anthropic") return await listAnthropicModels();
    if (provider === "openrouter") return await listOpenRouterModels();
    return await listOllamaModels();
  } catch (error) {
    console.warn(`[models] ดึงรายชื่อโมเดลของ ${provider} ไม่สำเร็จ:`, describeError(error));
    return FALLBACK_MODELS[provider].map((id) => ({ id, label: id }));
  }
}

async function listAnthropicModels(): Promise<ModelOption[]> {
  const client = getAnthropic();
  if (!client) return FALLBACK_MODELS.anthropic.map((id) => ({ id, label: id }));

  const page = await client.models.list({ limit: 100 });
  const options = page.data.map((m) => ({ id: m.id, label: m.display_name || m.id }));
  return options.length > 0
    ? options
    : FALLBACK_MODELS.anthropic.map((id) => ({ id, label: id }));
}

async function listOpenRouterModels(): Promise<ModelOption[]> {
  // endpoint นี้เปิดสาธารณะ ไม่ต้องใช้คีย์ก็ดูรายชื่อได้
  const data = await fetchJson<{ data?: Array<{ id?: string; name?: string }> }>(
    `${OPENROUTER_BASE}/models`,
    { headers: { Accept: "application/json" } },
    15_000,
  );
  return (data.data ?? [])
    .filter((m): m is { id: string; name?: string } => typeof m.id === "string")
    .map((m) => ({ id: m.id, label: m.name || m.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function listOllamaModels(): Promise<ModelOption[]> {
  const data = await fetchJson<{ models?: Array<{ name?: string; model?: string }> }>(
    `${ollamaBaseUrl()}/api/tags`,
    { headers: { Accept: "application/json" } },
    10_000,
  );
  return (data.models ?? [])
    .map((m) => m.name || m.model)
    .filter((name): name is string => Boolean(name))
    .map((name) => ({ id: name, label: name }));
}

// ────────────────────────────────────────────────────────────────────────────
// ทดสอบการเชื่อมต่อ
// ────────────────────────────────────────────────────────────────────────────

export interface LlmTestResult {
  ok: boolean;
  message: string;
  reply?: string;
}

const PING = 'ตอบกลับคำเดียวว่า "พร้อม"';

export async function testLlm(choice: LlmChoice): Promise<LlmTestResult> {
  const started = Date.now();
  try {
    const reply = await pingProvider(choice);
    return {
      ok: true,
      message:
        `เชื่อมต่อ ${PROVIDER_LABEL[choice.provider]} สำเร็จ ` +
        `(${Date.now() - started} ms) · โมเดล ${choice.model}`,
      reply: reply.slice(0, 80),
    };
  } catch (error) {
    return {
      ok: false,
      message: `เรียก ${PROVIDER_LABEL[choice.provider]} ไม่สำเร็จ — ${describeError(error)}`,
    };
  }
}

async function pingProvider(choice: LlmChoice): Promise<string> {
  if (choice.provider === "anthropic") {
    const client = getAnthropic();
    if (!client) throw new Error("ยังไม่ได้ตั้ง ANTHROPIC_API_KEY");
    const message = await client.messages.create(
      {
        model: choice.model,
        max_tokens: 4000,
        messages: [{ role: "user", content: PING }],
      },
      { timeout: 30_000 },
    );
    return extractAnthropicText(message);
  }

  if (choice.provider === "openrouter") {
    const key = openRouterKey();
    if (!key) throw new Error("ยังไม่ได้ตั้ง OPENROUTER_API_KEY");
    const data = await fetchJson<{ choices?: Array<{ message?: { content?: string } }> }>(
      `${OPENROUTER_BASE}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-Title": "Bai Jing Bai Lok",
        },
        body: JSON.stringify({
          model: choice.model,
          messages: [{ role: "user", content: PING }],
          max_tokens: 100,
        }),
      },
      30_000,
    );
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  }

  const data = await fetchJson<{ message?: { content?: string } }>(
    `${ollamaBaseUrl()}/api/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: choice.model,
        stream: false,
        messages: [{ role: "user", content: PING }],
        options: { num_predict: 100 },
      }),
    },
    30_000,
  );
  return data.message?.content?.trim() ?? "";
}

// ────────────────────────────────────────────────────────────────────────────
// ตัวช่วย HTTP
// ────────────────────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    const text = await res.text();
    if (!res.ok) {
      throw new HttpError(res.status, `HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.APIError) return `HTTP ${error.status}: ${error.message}`;
  if (error instanceof HttpError) return error.message;
  if (error instanceof Error) {
    // ต่อ Ollama ไม่ติดเป็นเคสที่เจอบ่อยสุด บอกให้ตรงจุดจะได้ไม่ต้องเดา
    if (error.name === "AbortError") return "หมดเวลารอคำตอบ";
    if (/ECONNREFUSED|fetch failed/i.test(error.message)) {
      return `ต่อไม่ติด (${error.message}) — ถ้าใช้ Ollama ให้เช็กว่าเปิดโปรแกรมอยู่จริง`;
    }
    return error.message;
  }
  return String(error);
}
