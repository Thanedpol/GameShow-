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
  /** เวลาต่อข้อ (วินาที) — นับรวมเวลาเปิดกล่องคำใบ้ */
  questionSeconds: number;
  /** จำนวนกล่องคำใบ้ต่อข้อ */
  boxCount: number;
  /** สัดส่วนคะแนนที่ถูกหักต่อการเปิด 1 กล่อง (0.25 = 25%) */
  boxCostRatio: number;
  /** โทเคนสะสมสูงสุด */
  maxTokens: number;
  /** คะแนนตั้งต้นของแต่ละช่วง */
  points: Record<Stage, number>;
  /** จำนวนข้อที่หยิบมาใช้ต่อ 1 เกม */
  counts: Record<Stage, number>;
}

export const DEFAULT_SETTINGS: GameSettings = {
  questionSeconds: 60,
  boxCount: 4,
  boxCostRatio: 0.25,
  maxTokens: 3,
  points: { warmup: 100, push: 200, final: 300 },
  counts: { warmup: 4, push: 4, final: 1 },
};

const SETTINGS_KEY = "baijing.settings.v1";
const QUESTIONS_KEY = "baijing.questions.v1";

const isBrowser = () => typeof window !== "undefined";

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** ตรวจค่าที่โหลดมาให้อยู่ในช่วงที่เกมยังเล่นได้ กันค่าพังจาก localStorage ที่ถูกแก้มือ */
export function normalizeSettings(raw: Partial<GameSettings> | null): GameSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  return {
    questionSeconds: clampNumber(raw.questionSeconds, 10, 600, DEFAULT_SETTINGS.questionSeconds),
    boxCount: clampNumber(raw.boxCount, 2, 6, DEFAULT_SETTINGS.boxCount),
    boxCostRatio: clampNumber(raw.boxCostRatio, 0, 1, DEFAULT_SETTINGS.boxCostRatio),
    maxTokens: clampNumber(raw.maxTokens, 0, 9, DEFAULT_SETTINGS.maxTokens),
    points: {
      warmup: clampNumber(raw.points?.warmup, 0, 100000, DEFAULT_SETTINGS.points.warmup),
      push: clampNumber(raw.points?.push, 0, 100000, DEFAULT_SETTINGS.points.push),
      final: clampNumber(raw.points?.final, 0, 100000, DEFAULT_SETTINGS.points.final),
    },
    counts: {
      warmup: clampNumber(raw.counts?.warmup, 0, 20, DEFAULT_SETTINGS.counts.warmup),
      push: clampNumber(raw.counts?.push, 0, 20, DEFAULT_SETTINGS.counts.push),
      final: clampNumber(raw.counts?.final, 0, 5, DEFAULT_SETTINGS.counts.final),
    },
  };
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
  };
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
