import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/**
 * ชั้นกลางที่คุยกับ LLM ทุกเจ้า
 *
 * รองรับ 5 ผู้ให้บริการ:
 *   anthropic  — เรียกผ่าน @anthropic-ai/sdk (structured output ของ Claude)
 *   openai     — POST /v1/chat/completions
 *   gemini     — POST /v1beta/openai/chat/completions (Google มี endpoint ที่เข้ากันได้กับ OpenAI)
 *   openrouter — POST /api/v1/chat/completions
 *   ollama     — POST /api/chat ของเครื่องที่รัน Ollama อยู่
 *
 * สามเจ้ากลางใช้รูปแบบ OpenAI เหมือนกันหมด จึงเดินทางเดียวกันใน
 * callOpenAiCompatJson() ต่างกันแค่ base URL, ชื่อ env ของคีย์ และชื่อพารามิเตอร์ token
 *
 * แบ่งความรับผิดชอบไว้ชัด:
 *   - "เลือกเจ้าไหน/โมเดลอะไร" ส่งมาจากหลังบ้านได้ เพราะไม่ใช่ความลับ
 *     แต่ต้องผ่าน allowlist + regex ก่อนเสมอ กัน client ยัดค่ามั่ว
 *   - "คีย์" ปกติอยู่ฝั่งเซิร์ฟเวอร์ (env) แต่รับจากหลังบ้านได้ด้วย (BYOK)
 *     เพราะบน Vercel ระบบไฟล์เป็น read-only จะแก้ .env.local ผ่านเว็บไม่ได้
 *     คีย์ที่ส่งมาถูกใช้เฉพาะ request นั้น ไม่เคยเขียนลงดิสก์ ไม่เคย log
 *     และไม่เคยถูกส่งกลับไปฝั่ง client
 */

export type LlmProvider = "anthropic" | "openai" | "gemini" | "openrouter" | "ollama";

export const LLM_PROVIDERS: LlmProvider[] = [
  "anthropic",
  "openai",
  "gemini",
  "openrouter",
  "ollama",
];

export const PROVIDER_LABEL: Record<LlmProvider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
  gemini: "Google (Gemini)",
  openrouter: "OpenRouter",
  ollama: "Ollama (เครื่องตัวเอง)",
};

/**
 * ใช้ตอนผู้ใช้ยังไม่เคยเลือกโมเดลของเจ้านั้น
 *
 * ฝั่ง Gemini ใช้ชื่อ -latest เพราะ Google ปลดระวางรุ่นเก่าโดยไม่เตือนล่วงหน้า
 * (gemini-2.0-flash ตายไปแล้ว ตอบ 404 "no longer available") การตรึงเลขรุ่นไว้
 * แปลว่าวันหนึ่งเกมจะตกไปโหมดสำรองเงียบ ๆ โดยไม่มีใครรู้
 */
export const DEFAULT_MODEL: Record<LlmProvider, string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-4o-mini",
  gemini: "gemini-flash-latest",
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
  openai: [],
  gemini: [],
  openrouter: [],
  ollama: [],
};

type OpenAiCompatProvider = "openai" | "gemini" | "openrouter";

interface OpenAiCompatConfig {
  baseUrl: string;
  envKey: string;
  /** โมเดลรุ่นใหม่ของ OpenAI ปฏิเสธ max_tokens ต้องใช้ max_completion_tokens แทน */
  tokenParam: "max_tokens" | "max_completion_tokens";
  /** ดูรายชื่อโมเดลได้โดยไม่ต้องมีคีย์ไหม */
  publicModelList: boolean;
  /** ตัดโมเดลที่ไม่ใช่ chat ออกจากดรอปดาวน์ (embedding, รูป, เสียง) */
  skipModel?: RegExp;
}

const OPENAI_COMPAT: Record<OpenAiCompatProvider, OpenAiCompatConfig> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    tokenParam: "max_completion_tokens",
    publicModelList: false,
    skipModel: /embed|tts|whisper|dall-e|moderation|audio|realtime|image|transcribe|sora/i,
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envKey: "GEMINI_API_KEY",
    tokenParam: "max_tokens",
    publicModelList: false,
    skipModel: /embedding|aqa|imagen|veo|tts|native-audio|learnlm/i,
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    tokenParam: "max_tokens",
    publicModelList: true,
  },
};

function isOpenAiCompat(provider: LlmProvider): provider is OpenAiCompatProvider {
  return provider === "openai" || provider === "gemini" || provider === "openrouter";
}

export function ollamaBaseUrl(): string {
  const raw = readEnvLoose("OLLAMA_BASE_URL") || "http://127.0.0.1:11434";
  return raw.replace(/\/+$/, "");
}

// ────────────────────────────────────────────────────────────────────────────
// เลือกผู้ให้บริการ + โมเดล
// ────────────────────────────────────────────────────────────────────────────

export interface LlmChoice {
  provider: LlmProvider;
  model: string;
  /** คีย์ที่หลังบ้านกรอกเอง — ถ้ามีจะใช้แทนคีย์ใน env ของเซิร์ฟเวอร์ */
  apiKey?: string;
}

/** ค่าที่หลังบ้านส่งมาแนบกับ request ได้ — ไม่บังคับ */
export interface LlmChoiceInput {
  provider?: string;
  model?: string;
  apiKey?: string;
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

/**
 * คีย์ที่ส่งมาจากหลังบ้านจะถูกยัดใส่ header `Authorization: Bearer ...`
 * จึงต้องกันอักขระขึ้นบรรทัดใหม่และช่องว่างให้หมด ไม่งั้นกลายเป็น header injection
 *
 * ชุดอักขระนี้ครอบคลุมคีย์ของทุกเจ้าที่รองรับ:
 *   sk-ant-... · sk-... · sk-or-v1-... · AIza... · AQ.xxxxx (มีจุดในคีย์)
 */
const API_KEY_PATTERN = /^[A-Za-z0-9._~+/=-]{16,400}$/;

export function sanitizeApiKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return API_KEY_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * โมเดลที่ผู้ให้บริการปลดระวางไปแล้ว → ชื่อที่ควรใช้แทน
 *
 * มีไว้เพราะเคยเจอของจริง: `HINT_MODEL=gemini-2.0-flash` ที่ตั้งไว้บน Vercel
 * กลายเป็น 404 หลัง Google ปิดรุ่นนั้น แล้วเกมตกไปโหมดสำรอง "เงียบ ๆ" ทุกครั้ง
 * โดยหน้าหลังบ้านยังโชว์ว่าตั้งค่าถูกอยู่ — กว่าจะรู้ก็ต่อเมื่อไล่อ่าน log
 *
 * การเปลี่ยนชื่อให้อัตโนมัติดีกว่าปล่อยพัง แต่ต้องเตือนใน log ด้วย
 * ไม่งั้นค่าที่ตั้งไว้กับค่าที่ใช้จริงจะไม่ตรงกันโดยไม่มีใครรู้
 */
const RETIRED_MODELS: Record<string, string> = {
  "gemini-2.0-flash": "gemini-flash-latest",
  "gemini-2.0-flash-lite": "gemini-flash-lite-latest",
  "gemini-1.5-flash": "gemini-flash-latest",
  "gemini-1.5-pro": "gemini-2.5-pro",
};

const warnedRetired = new Set<string>();

export function replaceRetiredModel(model: string): string {
  const replacement = RETIRED_MODELS[model];
  if (!replacement) return model;
  if (!warnedRetired.has(model)) {
    warnedRetired.add(model);
    console.warn(
      `[llm] โมเดล ${model} ถูกปลดระวางแล้ว — ใช้ ${replacement} แทนให้ชั่วคราว ` +
        `ควรแก้ HINT_MODEL หรือค่าที่เลือกในหลังบ้านให้ตรง`,
    );
  }
  return replacement;
}

/** ค่าตั้งต้นจาก env — ใช้เมื่อ client ไม่ได้ส่งอะไรมา */
export function envChoice(): LlmChoice {
  const raw = readEnvLoose("LLM_PROVIDER")?.toLowerCase();
  const provider = isProvider(raw) ? raw : "anthropic";
  const model = sanitizeModel(readEnvLoose("HINT_MODEL"));
  return {
    provider,
    model: model ? replaceRetiredModel(model) : DEFAULT_MODEL[provider],
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
  const apiKey = sanitizeApiKey(input.apiKey) ?? undefined;
  const model = sanitizeModel(input.model);
  // แทนที่โมเดลที่ถูกปลดระวางด้วย ไม่ใช่แค่ตอนอ่านจาก env
  // เพราะค่าที่เลือกไว้ในหลังบ้านก็ค้างอยู่ใน localStorage ได้เหมือนกัน
  if (model) return { provider, model: replaceRetiredModel(model), apiKey };

  return {
    provider,
    model: provider === fromEnv.provider ? fromEnv.model : DEFAULT_MODEL[provider],
    apiKey,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// สถานะความพร้อมของแต่ละเจ้า
// ────────────────────────────────────────────────────────────────────────────

/**
 * อ่านค่า env โดยไม่สนตัวพิมพ์เล็ก/ใหญ่
 *
 * ชื่อ env เป็น case-sensitive และแพลตฟอร์มอย่าง Vercel เก็บชื่อตามที่พิมพ์เป๊ะ ๆ
 * คนจึงตั้งเป็น Gemini_API_Key แล้วงงว่าทำไมไม่ทำงาน แถมหน้า Settings ของ Vercel
 * แก้ได้แค่ "ค่า" ไม่ได้แก้ "ชื่อ" ต้องลบทิ้งแล้วสร้างใหม่ ซึ่งไม่ชัดเลย
 *
 * การยอมรับชื่อที่ต่างแค่ตัวพิมพ์จึงคุ้มกว่าการยืนกรานให้ตรงเป๊ะ
 * (ยังเตือนในหลังบ้านอยู่ ผู้ใช้จะได้รู้ว่าควรตั้งชื่อให้ตรงมาตรฐาน)
 */
export function readEnvLoose(name: string): string | undefined {
  const exact = process.env[name]?.trim();
  if (exact) return exact;

  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toLowerCase() === wanted) {
      const trimmed = value?.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

export function anthropicKey(): string | undefined {
  return readEnvLoose("ANTHROPIC_API_KEY");
}

/** ชื่อ env ที่ต้องตั้งของเจ้านั้น — Ollama ไม่ต้องใช้คีย์จึงเป็น null */
export function providerEnvKey(provider: LlmProvider): string | null {
  if (provider === "anthropic") return "ANTHROPIC_API_KEY";
  if (provider === "ollama") return null;
  return OPENAI_COMPAT[provider].envKey;
}

/**
 * คีย์ที่จะใช้จริงของเจ้านั้น
 * คีย์ที่หลังบ้านกรอกมา (override) มาก่อน env เสมอ — บน Vercel แก้ env ผ่านเว็บไม่ได้
 * ถ้าไม่ยอมให้ override ก็จะเปลี่ยนคีย์ไม่ได้เลยจนกว่าจะ redeploy
 */
export function providerKey(provider: LlmProvider, override?: string): string | undefined {
  const envKey = providerEnvKey(provider);
  if (!envKey) return undefined; // Ollama ไม่ใช้คีย์ — กัน override หลุดไปที่อื่น
  return sanitizeApiKey(override) ?? readEnvLoose(envKey);
}

/** Ollama ไม่ต้องใช้คีย์ ขอแค่มี URL — จะรู้ว่าต่อติดจริงไหมตอนกดทดสอบ */
export function isProviderReady(provider: LlmProvider, override?: string): boolean {
  if (provider === "ollama") return true;
  return Boolean(providerKey(provider, override));
}

/** เวอร์ชันที่รับ choice ทั้งก้อน เพื่อไม่ให้ลืมส่ง apiKey ที่แนบมาด้วย */
export function isChoiceReady(choice: LlmChoice): boolean {
  return isProviderReady(choice.provider, choice.apiKey);
}

let cachedAnthropic: Anthropic | null = null;

export function getAnthropic(override?: string): Anthropic | null {
  // คีย์ที่ผู้ใช้กรอกเองห้ามลงแคช ไม่งั้นคีย์ของคนหนึ่งจะถูกใช้ใน request ของอีกคน
  const supplied = sanitizeApiKey(override);
  if (supplied) return new Anthropic({ apiKey: supplied, maxRetries: 1 });

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
  /**
   * ที่รองเก็บสาเหตุที่เรียกไม่สำเร็จ
   *
   * ปกติฟังก์ชันนี้กลืน error แล้วคืน null เพื่อให้เกมตกไปโหมดสำรองได้เงียบ ๆ
   * แต่หน้าหลังบ้านต้องบอกผู้ใช้ให้ได้ว่าพังเพราะอะไร — บน Vercel เปิดดู log
   * ไม่ได้ง่าย ๆ ถ้าไม่ส่งสาเหตุกลับไปก็ได้แต่เดา
   */
  errorSink?: string[];
}

export async function callLlmJson<T>(
  choice: LlmChoice,
  options: LlmJsonOptions,
): Promise<T | null> {
  const timeoutMs = options.timeoutMs ?? 40_000;
  try {
    if (choice.provider === "anthropic") {
      return await callAnthropicJson<T>(choice.model, options, timeoutMs, choice.apiKey);
    }
    if (isOpenAiCompat(choice.provider)) {
      return await callOpenAiCompatJson<T>(
        choice.provider,
        choice.model,
        options,
        timeoutMs,
        choice.apiKey,
      );
    }
    return await callOllamaJson<T>(choice.model, options, timeoutMs);
  } catch (error) {
    const detail = describeError(error);
    console.error(`[${options.tag}] เรียก ${choice.provider} ไม่สำเร็จ:`, detail);
    options.errorSink?.push(`${choice.provider}/${choice.model}: ${detail}`);
    return null;
  }
}

async function callAnthropicJson<T>(
  model: string,
  { system, prompt, schema, maxTokens, tag }: LlmJsonOptions,
  timeoutMs: number,
  apiKey?: string,
): Promise<T | null> {
  const client = getAnthropic(apiKey);
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

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * ทางเดินร่วมของ OpenAI / Gemini / OpenRouter — ทั้งสามใช้รูปแบบ chat completions เหมือนกัน
 *
 * ส่ง response_format แบบ json_schema ไปก่อน ถ้าโมเดลนั้นไม่รองรับแล้วโดนปฏิเสธด้วย 4xx
 * จะลองใหม่อีกรอบโดยไม่ส่ง response_format แล้วอาศัยสคีมาที่ฝังใน system prompt แทน
 */
async function callOpenAiCompatJson<T>(
  provider: OpenAiCompatProvider,
  model: string,
  { system, prompt, schema, maxTokens, tag }: LlmJsonOptions,
  timeoutMs: number,
  apiKey?: string,
): Promise<T | null> {
  const cfg = OPENAI_COMPAT[provider];
  const key = providerKey(provider, apiKey);
  if (!key) return null;

  const messages = [
    { role: "system", content: withSchemaInstruction(system, schema) },
    { role: "user", content: prompt },
  ];

  const send = (structured: boolean) =>
    fetchJson<ChatCompletion>(
      `${cfg.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...(provider === "openrouter" ? { "X-Title": "Bai Jing Bai Lok" } : {}),
        },
        body: JSON.stringify({
          model,
          messages,
          [cfg.tokenParam]: maxTokens,
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

  let data: ChatCompletion;
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

export interface ModelListResult {
  models: ModelOption[];
  /** null = สำเร็จ · มีค่า = บอกสาเหตุจริงที่ดึงไม่ได้ */
  error: string | null;
}

/**
 * เดิมฟังก์ชันนี้ catch แล้วคืนลิสต์ว่างเฉย ๆ ทำให้ผู้ใช้เห็นแค่ "ไม่พบโมเดล"
 * เหมือนกันหมดไม่ว่าจะเพราะยังไม่ใส่คีย์ คีย์ผิด หรือเน็ตมีปัญหา — วินิจฉัยไม่ได้เลย
 * ตอนนี้ส่งสาเหตุจริงกลับไปให้หน้าหลังบ้านแสดง
 */
export async function listModels(
  provider: LlmProvider,
  apiKey?: string,
): Promise<ModelListResult> {
  // OpenRouter เปิดรายชื่อสาธารณะ · Anthropic มีลิสต์สำรองในโค้ดอยู่แล้ว
  // เหลือ OpenAI กับ Gemini ที่ไม่มีคีย์แล้วดูอะไรไม่ได้เลย
  const needsKey = provider === "openai" || provider === "gemini";
  const envKey = providerEnvKey(provider);
  if (needsKey && envKey && !providerKey(provider, apiKey)) {
    return {
      models: [],
      error:
        `ยังไม่มีคีย์ของ ${envKey} ให้ใช้ — ใส่คีย์ในช่อง API key ด้านบนแล้วกดบันทึกก่อน ` +
        `หรือจะตั้งเป็น env บนเซิร์ฟเวอร์ก็ได้ (บน Vercel ต้อง redeploy หลังตั้ง)`,
    };
  }

  try {
    if (provider === "anthropic") {
      return { models: await listAnthropicModels(apiKey), error: null };
    }
    if (isOpenAiCompat(provider)) {
      return { models: await listOpenAiCompatModels(provider, apiKey), error: null };
    }
    return { models: await listOllamaModels(), error: null };
  } catch (error) {
    const detail = describeError(error);
    console.warn(`[models] ดึงรายชื่อโมเดลของ ${provider} ไม่สำเร็จ:`, detail);
    return {
      models: FALLBACK_MODELS[provider].map((id) => ({ id, label: id })),
      error: detail,
    };
  }
}

async function listAnthropicModels(apiKey?: string): Promise<ModelOption[]> {
  const client = getAnthropic(apiKey);
  if (!client) return FALLBACK_MODELS.anthropic.map((id) => ({ id, label: id }));

  const page = await client.models.list({ limit: 100 });
  const options = page.data.map((m) => ({ id: m.id, label: m.display_name || m.id }));
  return options.length > 0
    ? options
    : FALLBACK_MODELS.anthropic.map((id) => ({ id, label: id }));
}

async function listOpenAiCompatModels(
  provider: OpenAiCompatProvider,
  apiKey?: string,
): Promise<ModelOption[]> {
  const cfg = OPENAI_COMPAT[provider];
  const key = providerKey(provider, apiKey);
  // OpenRouter เปิดรายชื่อสาธารณะ ส่วน OpenAI/Gemini ต้องมีคีย์ก่อนถึงจะดูได้
  if (!key && !cfg.publicModelList) return [];

  const data = await fetchJson<{ data?: Array<{ id?: string; name?: string }> }>(
    `${cfg.baseUrl}/models`,
    {
      headers: {
        Accept: "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
    },
    15_000,
  );

  return (data.data ?? [])
    .filter((m): m is { id: string; name?: string } => typeof m.id === "string")
    .filter((m) => !cfg.skipModel?.test(m.id))
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
    const client = getAnthropic(choice.apiKey);
    if (!client) throw new Error("ยังไม่มีคีย์ของ Claude — ใส่ในช่อง API key หรือตั้ง ANTHROPIC_API_KEY");
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

  if (isOpenAiCompat(choice.provider)) {
    const cfg = OPENAI_COMPAT[choice.provider];
    const key = providerKey(choice.provider, choice.apiKey);
    if (!key) throw new Error(`ยังไม่มีคีย์ — ใส่ในช่อง API key หรือตั้ง ${cfg.envKey}`);
    const data = await fetchJson<ChatCompletion>(
      `${cfg.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...(choice.provider === "openrouter" ? { "X-Title": "Bai Jing Bai Lok" } : {}),
        },
        body: JSON.stringify({
          model: choice.model,
          messages: [{ role: "user", content: PING }],
          // โมเดลที่คิดก่อนตอบกินโทเคนไปกับ reasoning ให้เผื่อไว้หน่อยจะได้ไม่ได้ค่าว่าง
          [cfg.tokenParam]: 2000,
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

/**
 * ดึงข้อความ error ที่คนอ่านรู้เรื่องออกจาก body
 * ทุกเจ้าห่อไว้คนละชั้น เช่น Google ใช้ { error: { message } } ส่วน OpenAI ใช้ { error: { message } }
 * ถ้าแกะไม่ได้ค่อยคืน body ดิบแบบตัดสั้น
 */
interface ApiErrorBody {
  error?: { message?: string } | string;
  message?: string;
}

function extractApiMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as ApiErrorBody | ApiErrorBody[];
    // Gemini ห่อ error ของ chat/completions มาใน array ส่วน endpoint อื่นส่งเป็น object เดี่ยว
    const body = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!body) return text.slice(0, 200);
    if (typeof body.error === "string") return body.error;
    if (body.error?.message) return body.error.message;
    if (body.message) return body.message;
  } catch {
    /* ไม่ใช่ JSON */
  }
  return text.slice(0, 200);
}

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    const text = await res.text();
    if (!res.ok) {
      throw new HttpError(res.status, `HTTP ${res.status}: ${extractApiMessage(text)}`);
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
