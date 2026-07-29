import { QUESTION_BANK } from "./questions";
import type { Question, Stage } from "./types";

/**
 * ค่าที่ปรับได้จากหลังบ้าน (/admin)
 *
 * เก็บใน localStorage ของเบราว์เซอร์ ไม่ใช่ฐานข้อมูล — ตรงตามข้อกำหนดว่า
 * prototype นี้ไม่มี DB ผลคือการตั้งค่าผูกกับเครื่อง/เบราว์เซอร์ที่แก้
 * ถ้าจะย้ายไปเครื่องอื่นให้ใช้ปุ่ม Export/Import JSON ในหน้าหลังบ้าน
 */
export interface GameSettings {
  /** จำนวนกล่องคำใบ้ที่วางให้เห็นต่อข้อ */
  boxCount: number;
  /** สัดส่วนคะแนนที่ถูกหักต่อการเปิด 1 กล่อง (0.25 = 25%) */
  boxCostRatio: number;
  /** โทเคนสะสมสูงสุด */
  maxTokens: number;
  /** เวลาต่อข้อ แยกตามช่วง (วินาที) — นับรวมเวลาเปิดกล่องคำใบ้ */
  seconds: Record<Stage, number>;
  /** เปิดกล่องคำใบ้ได้สูงสุดกี่กล่อง แยกตามช่วง */
  maxOpenBoxes: Record<Stage, number>;
  /** คะแนนตั้งต้นของแต่ละช่วง */
  points: Record<Stage, number>;
  /** จำนวนข้อที่หยิบมาใช้ต่อ 1 เกม */
  counts: Record<Stage, number>;
  /**
   * live = ให้ AI แต่งคำถามใหม่จากข่าว/บทความจริงทุกเกม (ขาดเท่าไรเติมจากคลัง)
   * bank = ใช้คลังในเครื่องอย่างเดียว ไม่เรียก AI ไม่เสียโทเคน
   */
  questionSource: QuestionSource;
  /** กลุ่มฟีดที่อนุญาตให้ดึงข่าวมาตั้งคำถาม — ว่าง = ใช้ทุกกลุ่ม */
  feedGroups: string[];
}

export type QuestionSource = "live" | "bank";

/**
 * ต้องตรงกับ FeedGroup ใน lib/sources.ts
 * ประกาศซ้ำที่นี่เพราะ sources.ts เป็น server-only — ฝั่ง client import ไม่ได้
 */
export const FEED_GROUP_CHOICES = [
  "life",
  "work",
  "tech",
  "money",
  "health",
  "science",
  "security",
] as const;

export const FEED_GROUP_TH: Record<string, string> = {
  life: "ชีวิตและวัฒนธรรม",
  work: "ธุรกิจและที่ทำงาน",
  tech: "เทคโนโลยีและ AI",
  money: "การเงินส่วนบุคคล",
  health: "สุขภาพ",
  science: "วิทยาศาสตร์",
  security: "ภัยไซเบอร์และสแกม",
};

export const DEFAULT_SETTINGS: GameSettings = {
  boxCount: 4,
  boxCostRatio: 0.25,
  maxTokens: 3,
  seconds: { warmup: 60, push: 30, final: 20 },
  maxOpenBoxes: { warmup: 1, push: 1, final: 2 },
  points: { warmup: 100, push: 200, final: 300 },
  counts: { warmup: 7, push: 9, final: 4 },
  questionSource: "live",
  feedGroups: [...FEED_GROUP_CHOICES],
};

const SETTINGS_KEY = "baijing.settings.v1";
const QUESTIONS_KEY = "baijing.questions.v1";
const LLM_KEY = "baijing.llm.v1";
const API_KEYS_KEY = "baijing.apikeys.v1";

const isBrowser = () => typeof window !== "undefined";

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** ตรวจค่าที่โหลดมาให้อยู่ในช่วงที่เกมยังเล่นได้ กันค่าพังจาก localStorage ที่ถูกแก้มือ */
const STAGES: Stage[] = ["warmup", "push", "final"];

/** อ่านค่ารายช่วงจากของที่เซฟไว้ พร้อม clamp ให้อยู่ในช่วงที่เกมยังเล่นได้ */
function stageRecord(
  raw: Partial<Record<Stage, number>> | undefined,
  fallback: Record<Stage, number>,
  min: number,
  max: number,
): Record<Stage, number> {
  const out = {} as Record<Stage, number>;
  for (const s of STAGES) out[s] = clampNumber(raw?.[s], min, max, fallback[s]);
  return out;
}

export function normalizeSettings(raw: Partial<GameSettings> | null): GameSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  const boxCount = clampNumber(raw.boxCount, 2, 6, DEFAULT_SETTINGS.boxCount);
  return {
    boxCount,
    boxCostRatio: clampNumber(raw.boxCostRatio, 0, 1, DEFAULT_SETTINGS.boxCostRatio),
    maxTokens: clampNumber(raw.maxTokens, 0, 9, DEFAULT_SETTINGS.maxTokens),
    seconds: stageRecord(raw.seconds, DEFAULT_SETTINGS.seconds, 5, 600),
    // เปิดได้ไม่เกินจำนวนกล่องที่วางไว้จริง
    maxOpenBoxes: stageRecord(raw.maxOpenBoxes, DEFAULT_SETTINGS.maxOpenBoxes, 0, boxCount),
    points: stageRecord(raw.points, DEFAULT_SETTINGS.points, 0, 100000),
    counts: stageRecord(raw.counts, DEFAULT_SETTINGS.counts, 0, 30),
    questionSource: raw.questionSource === "bank" ? "bank" : "live",
    feedGroups: normalizeFeedGroups(raw.feedGroups),
  };
}

/** ปิดทุกกลุ่มเท่ากับเปิดทุกกลุ่ม — ไม่งั้นจะไม่มีข่าวให้ตั้งคำถามเลย */
function normalizeFeedGroups(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...FEED_GROUP_CHOICES];
  const picked = raw.filter(
    (g): g is string => typeof g === "string" && (FEED_GROUP_CHOICES as readonly string[]).includes(g),
  );
  return picked.length > 0 ? picked : [...FEED_GROUP_CHOICES];
}

export function loadSettings(): GameSettings {
  if (!isBrowser()) return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return normalizeSettings(raw ? (JSON.parse(raw) as Partial<GameSettings>) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
}

export function resetSettings(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(SETTINGS_KEY);
}

// ────────────────────────────────────────────────────────────────────────────
// ผู้ให้บริการ LLM + โมเดล ที่เลือกจากหลังบ้าน
// ────────────────────────────────────────────────────────────────────────────

/**
 * เก็บแยกจาก GameSettings เพราะไม่ได้ล็อกตอนเริ่มเกมเหมือนกติกา
 *
 * "auto" = ใช้ค่าที่ตั้งไว้ใน env ของเซิร์ฟเวอร์ (LLM_PROVIDER / HINT_MODEL)
 */
export type LlmProviderChoice =
  | "auto"
  | "anthropic"
  | "openai"
  | "gemini"
  | "openrouter"
  | "ollama";

export interface LlmSettings {
  provider: LlmProviderChoice;
  /** เว้นว่าง = ให้เซิร์ฟเวอร์เลือกโมเดลตั้งต้นของเจ้านั้นเอง */
  model: string;
}

export const DEFAULT_LLM_SETTINGS: LlmSettings = { provider: "auto", model: "" };

const PROVIDER_CHOICES: LlmProviderChoice[] = [
  "auto",
  "anthropic",
  "openai",
  "gemini",
  "openrouter",
  "ollama",
];

/** ชื่อโมเดลใช้ได้แค่ตัวอักษร ตัวเลข และ . _ - / : (ตรงกับที่เซิร์ฟเวอร์ตรวจซ้ำอีกชั้น) */
const MODEL_PATTERN = /^[\w.:\/-]{1,120}$/;

export function normalizeLlmSettings(raw: Partial<LlmSettings> | null): LlmSettings {
  if (!raw) return { ...DEFAULT_LLM_SETTINGS };
  const provider = PROVIDER_CHOICES.includes(raw.provider as LlmProviderChoice)
    ? (raw.provider as LlmProviderChoice)
    : "auto";
  const model = typeof raw.model === "string" ? raw.model.trim() : "";
  return { provider, model: MODEL_PATTERN.test(model) ? model : "" };
}

export function loadLlmSettings(): LlmSettings {
  if (!isBrowser()) return { ...DEFAULT_LLM_SETTINGS };
  try {
    const raw = window.localStorage.getItem(LLM_KEY);
    return normalizeLlmSettings(raw ? (JSON.parse(raw) as Partial<LlmSettings>) : null);
  } catch {
    return { ...DEFAULT_LLM_SETTINGS };
  }
}

export function saveLlmSettings(settings: LlmSettings): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(LLM_KEY, JSON.stringify(normalizeLlmSettings(settings)));
}

export function resetLlmSettings(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(LLM_KEY);
}

// ────────────────────────────────────────────────────────────────────────────
// คีย์ API ที่กรอกเองจากหลังบ้าน (BYOK)
// ────────────────────────────────────────────────────────────────────────────

/**
 * ทำไมต้องเก็บคีย์ไว้ในเบราว์เซอร์
 *
 * ทางหลักยังเป็น env ของเซิร์ฟเวอร์เหมือนเดิม แต่บน Vercel ระบบไฟล์เป็น read-only
 * จะเขียน .env.local ผ่านหน้าเว็บไม่ได้ ถ้าไม่มีทางนี้ก็แปลว่าเว็บจริงเปลี่ยนคีย์ไม่ได้เลย
 * ต้องไปตั้งที่ Vercel แล้ว redeploy ทุกครั้ง
 *
 * ข้อแลกเปลี่ยนที่ต้องรู้:
 * - คีย์อยู่ใน localStorage ของเบราว์เซอร์เครื่องนั้น ใครเปิดเครื่องนั้นได้ก็อ่านได้
 * - คีย์เดินทางไปกับ request ทุกครั้งที่เรียก /api/hint /api/grade /api/debrief
 *   (ผ่าน HTTPS · เซิร์ฟเวอร์ใช้แล้วทิ้ง ไม่เขียนลงดิสก์ ไม่ log ไม่ส่งกลับ)
 * - ไม่ได้ผูกกับบัญชี ใครเปิดหลังบ้านบนเครื่องตัวเองก็ใส่คีย์ของตัวเองแยกกัน
 */
export type KeyedProvider = "anthropic" | "openai" | "gemini" | "openrouter";

export const KEYED_PROVIDERS: KeyedProvider[] = [
  "anthropic",
  "openai",
  "gemini",
  "openrouter",
];

/** ต้องตรงกับ API_KEY_PATTERN ฝั่งเซิร์ฟเวอร์ ไม่งั้นบันทึกได้แต่ใช้ไม่ได้ */
const API_KEY_PATTERN = /^[A-Za-z0-9._~+/=-]{16,400}$/;

export function isValidApiKey(value: string): boolean {
  return API_KEY_PATTERN.test(value.trim());
}

export type ApiKeyMap = Partial<Record<KeyedProvider, string>>;

export function loadApiKeys(): ApiKeyMap {
  if (!isBrowser()) return {};
  try {
    const raw = window.localStorage.getItem(API_KEYS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: ApiKeyMap = {};
    for (const provider of KEYED_PROVIDERS) {
      const value = parsed[provider];
      if (typeof value === "string" && isValidApiKey(value)) out[provider] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export function saveApiKey(provider: KeyedProvider, key: string): void {
  if (!isBrowser()) return;
  const next = { ...loadApiKeys(), [provider]: key.trim() };
  window.localStorage.setItem(API_KEYS_KEY, JSON.stringify(next));
}

export function clearApiKey(provider: KeyedProvider): void {
  if (!isBrowser()) return;
  const next = loadApiKeys();
  delete next[provider];
  window.localStorage.setItem(API_KEYS_KEY, JSON.stringify(next));
}

const isKeyedProvider = (value: string): value is KeyedProvider =>
  (KEYED_PROVIDERS as string[]).includes(value);

/**
 * แปลงเป็นก้อนที่แนบไปกับ /api/hint, /api/grade, /api/debrief
 * คืน undefined เมื่อยังเป็น "auto" ทั้งหมด เพื่อให้เซิร์ฟเวอร์ใช้ค่า env ตามเดิม
 *
 * คีย์จะถูกแนบเฉพาะตอนที่เลือกค่ายไว้ชัดเจนแล้วเท่านั้น — ตอนเป็น "auto"
 * ฝั่ง client ไม่รู้ว่าเซิร์ฟเวอร์ตั้งค่ายอะไรไว้ จึงไม่รู้ว่าจะส่งคีย์ของใคร
 */
/**
 * ก้อน llm ที่ระบุค่าชัดเจนเสมอ ไม่ปล่อยให้เป็น undefined
 *
 * ใช้ในหลังบ้านตอนกด "ลองสร้างดู" — ต่างจาก llmRequestPayload() ตรงที่ตัวนั้น
 * คืน undefined เมื่อยังเป็น "ตามเซิร์ฟเวอร์" แล้วเซิร์ฟเวอร์จะไปหยิบ HINT_MODEL
 * ของ env มาใช้ ซึ่งอาจเป็นโมเดลที่ถูกปลดระวางไปแล้ว (เคยเจอกับ gemini-2.0-flash)
 * ผลคือกดปุ่มแล้วพังโดยที่หน้าจอยังโชว์ว่าตั้งค่าถูกอยู่
 *
 * ต้องส่ง serverProvider/serverModel จาก /api/admin/config เข้ามา เพราะฝั่ง client
 * ไม่รู้ว่า env ของเซิร์ฟเวอร์ตั้งอะไรไว้
 */
export function explicitLlmPayload(
  serverProvider?: string,
  serverModel?: string,
): { provider: string; model?: string; apiKey?: string } {
  const { provider, model } = loadLlmSettings();
  const effective = provider === "auto" ? (serverProvider ?? "anthropic") : provider;
  const apiKey = isKeyedProvider(effective) ? loadApiKeys()[effective] : undefined;
  return {
    provider: effective,
    // ล็อกค่ายเองแล้วแต่ไม่ได้เลือกโมเดล = ให้เซิร์ฟเวอร์เลือกดีฟอลต์ของค่ายนั้น
    model: model || (provider === "auto" ? serverModel || undefined : undefined),
    apiKey,
  };
}

export function llmRequestPayload():
  | { provider?: string; model?: string; apiKey?: string }
  | undefined {
  const { provider, model } = loadLlmSettings();
  const apiKey = isKeyedProvider(provider) ? loadApiKeys()[provider] : undefined;
  if (provider === "auto" && !model) return undefined;
  return {
    provider: provider === "auto" ? undefined : provider,
    model: model || undefined,
    apiKey,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// คลังคำถามที่แก้ได้จากหลังบ้าน
// ────────────────────────────────────────────────────────────────────────────

const VALID_STAGES: Stage[] = ["warmup", "push", "final"];

/** คัดเฉพาะฟิลด์ที่รู้จัก และทิ้งข้อที่ข้อมูลไม่ครบ */
export function sanitizeQuestion(input: unknown): Question | null {
  if (!input || typeof input !== "object") return null;
  const q = input as Record<string, unknown>;
  if (typeof q.id !== "string" || !q.id.trim()) return null;
  if (typeof q.prompt !== "string" || !q.prompt.trim()) return null;

  const format =
    q.format === "choice" || q.format === "open" || q.format === "performance"
      ? q.format
      : "choice";
  const stage = VALID_STAGES.includes(q.stage as Stage) ? (q.stage as Stage) : "warmup";

  const choices = Array.isArray(q.choices)
    ? q.choices.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    : [];

  // ปรนัยต้องมีตัวเลือกและคำตอบที่อยู่ในตัวเลือกจริง ไม่งั้นข้อนั้นเล่นไม่ได้
  if (format === "choice") {
    if (choices.length < 2) return null;
    if (typeof q.correctAnswer !== "string" || !choices.includes(q.correctAnswer)) return null;
  }

  return {
    id: q.id.trim(),
    prompt: q.prompt.trim(),
    format,
    stage,
    category: (typeof q.category === "string" ? q.category : "ชีวิตจริง") as Question["category"],
    difficulty: (q.difficulty === "ง่าย" || q.difficulty === "กลาง" || q.difficulty === "ยาก"
      ? q.difficulty
      : "กลาง") as Question["difficulty"],
    pointValue: clampNumber(q.pointValue, 0, 100000, DEFAULT_SETTINGS.points[stage]),
    choices: format === "choice" ? choices : undefined,
    correctAnswer: format === "choice" ? (q.correctAnswer as string) : undefined,
    rubric: typeof q.rubric === "string" ? q.rubric : undefined,
    keyPoints: Array.isArray(q.keyPoints)
      ? q.keyPoints.filter((k): k is string => typeof k === "string")
      : undefined,
    task: typeof q.task === "string" ? q.task : undefined,
    explanation: typeof q.explanation === "string" ? q.explanation : undefined,
    hints: sanitizeHints(q.hints),
  };
}

const asLines = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];

function sanitizeHints(input: unknown): Question["hints"] {
  if (!input || typeof input !== "object") return undefined;
  const h = input as Record<string, unknown>;
  const real = asLines(h.real);
  const fake = asLines(h.fake);
  if (real.length === 0 && fake.length === 0) return undefined;
  return { real, fake };
}

export function loadQuestions(): Question[] {
  if (!isBrowser()) return QUESTION_BANK;
  try {
    const raw = window.localStorage.getItem(QUESTIONS_KEY);
    if (!raw) return QUESTION_BANK;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return QUESTION_BANK;
    const cleaned = parsed
      .map(sanitizeQuestion)
      .filter((q): q is Question => q !== null);
    return cleaned.length > 0 ? cleaned : QUESTION_BANK;
  } catch {
    return QUESTION_BANK;
  }
}

export function saveQuestions(questions: Question[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(QUESTIONS_KEY, JSON.stringify(questions));
}

export function resetQuestions(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(QUESTIONS_KEY);
}

export function isUsingCustomQuestions(): boolean {
  if (!isBrowser()) return false;
  return window.localStorage.getItem(QUESTIONS_KEY) !== null;
}
