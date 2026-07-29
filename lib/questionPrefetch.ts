"use client";

import { fingerprint, markSeen, recentTopics, seenFingerprints, seenIds } from "./history";
import { drawQuestions } from "./questions";
import {
  loadLlmSettings,
  loadQuestions,
  loadSettings,
  llmRequestPayload,
  type GameSettings,
} from "./settings";
import type { Question, Stage } from "./types";

/**
 * เตรียมชุดคำถามไว้ล่วงหน้าตั้งแต่ผู้เล่นยังอยู่หน้าตั้งค่า
 *
 * การแต่งคำถาม 20 ข้อจากข่าวจริงใช้เวลาราว 30-40 วินาที ถ้ารอตอนกด "เริ่มเกม"
 * ผู้เล่นจะเจอหน้าโหลดยาว ๆ ทุกครั้ง แต่ช่วงที่กำลังเลือกโหมดและพิมพ์ชื่ออยู่นั้น
 * ว่างอยู่แล้ว จึงยิงงานไปเงียบ ๆ ตอนนั้นแทน พอกดเริ่มก็ได้เล่นทันที
 *
 * เก็บ promise ไว้ระดับโมดูล ไม่ใช่ใน state ของ component เพราะ:
 * - กดสลับโหมดไปมาต้องไม่ยิงซ้ำ (แต่ละครั้งคือเงินจริง)
 * - React StrictMode เรียก effect สองรอบตอน dev
 */

export type PrefetchStatus = "idle" | "loading" | "ready" | "fallback";

export interface PreparedSet {
  questions: Question[];
  /** สร้างสดได้กี่ข้อ ที่เหลือมาจากคลังในเครื่อง */
  liveCount: number;
  sourcesUsed: string[];
}

interface QuestionsApiShape {
  questions?: unknown[];
  shortfall?: Record<string, number>;
  source?: string;
  sourcesUsed?: string[];
}

const STAGES: Stage[] = ["warmup", "push", "final"];

let inflight: Promise<PreparedSet> | null = null;
let cached: PreparedSet | null = null;
/** ลายเซ็นของกติกาที่ใช้ตอนเตรียม — กติกาเปลี่ยนแล้วของเดิมใช้ไม่ได้ */
let cachedKey = "";

function settingsKey(settings: GameSettings): string {
  const llm = loadLlmSettings();
  return JSON.stringify([
    settings.counts,
    settings.points,
    settings.questionSource,
    settings.feedGroups,
    llm.provider,
    llm.model,
  ]);
}

/** เติมส่วนที่ขาดจากคลังในเครื่อง โดยเลี่ยงข้อที่เพิ่งเล่นไป */
function fillFromBank(
  settings: GameSettings,
  alreadyHave: Question[],
): Question[] {
  const need: Partial<Record<Stage, number>> = {};
  let total = 0;
  for (const stage of STAGES) {
    const have = alreadyHave.filter((q) => q.stage === stage).length;
    const missing = Math.max(0, settings.counts[stage] - have);
    if (missing > 0) need[stage] = missing;
    total += missing;
  }
  if (total === 0) return [];

  return drawQuestions({
    bank: loadQuestions(),
    counts: need,
    points: settings.points,
    exclude: seenIds(),
  });
}

/** เรียงตามลำดับช่วงของเกม — warmup ทั้งหมด แล้ว push แล้ว final */
function orderByStage(questions: Question[]): Question[] {
  return STAGES.flatMap((stage) => questions.filter((q) => q.stage === stage));
}

async function requestLive(settings: GameSettings): Promise<PreparedSet> {
  const stages = STAGES.filter((s) => settings.counts[s] > 0).map((stage) => ({
    stage,
    count: settings.counts[stage],
    pointValue: settings.points[stage],
  }));

  const res = await fetch("/api/questions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stages,
      groups: settings.feedGroups,
      avoid: recentTopics(40),
      llm: llmRequestPayload(),
    }),
  });
  if (!res.ok) throw new Error(String(res.status));

  const data = (await res.json()) as QuestionsApiShape;
  // ข้อที่สร้างมาผ่านตัวตรวจฝั่งเซิร์ฟเวอร์แล้ว แต่ยังต้องกันคำถามที่เครื่องนี้เคยเจอ
  // เทียบด้วยลายนิ้วมือของตัวคำถาม ไม่ใช่ id — โมเดลเขียนประโยคเดียวกันด้วยคำต่างกันนิดหน่อยได้
  const seenFp = seenFingerprints();
  const live = (data.questions ?? []).filter(
    (q): q is Question =>
      Boolean(q) &&
      typeof (q as Question).prompt === "string" &&
      !seenFp.has(fingerprint((q as Question).prompt)),
  );

  return {
    questions: live,
    liveCount: live.length,
    sourcesUsed: data.sourcesUsed ?? [],
  };
}

async function prepare(settings: GameSettings): Promise<PreparedSet> {
  let live: PreparedSet = { questions: [], liveCount: 0, sourcesUsed: [] };

  if (settings.questionSource === "live") {
    try {
      live = await requestLive(settings);
    } catch {
      // เน็ตล่มหรือ route พัง — ปล่อยให้คลังในเครื่องรับงานต่อ
      live = { questions: [], liveCount: 0, sourcesUsed: [] };
    }
  }

  const filler = fillFromBank(settings, live.questions);
  return {
    questions: orderByStage([...live.questions, ...filler]),
    liveCount: live.liveCount,
    sourcesUsed: live.sourcesUsed,
  };
}

/**
 * เริ่มเตรียมชุดคำถาม ถ้ากำลังเตรียมอยู่หรือเตรียมเสร็จแล้วจะไม่ยิงซ้ำ
 * เรียกซ้ำได้ปลอดภัย
 */
export function startPrefetch(): void {
  const settings = loadSettings();
  const key = settingsKey(settings);
  if (key === cachedKey && (cached || inflight)) return;

  cachedKey = key;
  cached = null;
  inflight = prepare(settings)
    .then((result) => {
      cached = result;
      return result;
    })
    .catch(() => {
      // ไม่ควรเกิดเพราะ prepare จับ error ไว้หมดแล้ว แต่กันเหนียวไม่ให้ promise ค้าง
      const fallback: PreparedSet = {
        questions: orderByStage(fillFromBank(loadSettings(), [])),
        liveCount: 0,
        sourcesUsed: [],
      };
      cached = fallback;
      return fallback;
    })
    .finally(() => {
      inflight = null;
    });
}

export function prefetchReady(): boolean {
  return cached !== null;
}

/**
 * เอาชุดที่เตรียมไว้ไปใช้ — ถ้ายังไม่เสร็จจะรอ ถ้ายังไม่เริ่มจะเริ่มให้
 * เรียกตอนกด "เริ่มเกม" แล้วบันทึกลงความจำกันซ้ำทันที
 */
export async function takeQuestions(): Promise<PreparedSet> {
  if (!cached && !inflight) startPrefetch();

  const result = cached ?? (await inflight!) ?? null;
  const final =
    result && result.questions.length > 0
      ? result
      : { questions: orderByStage(fillFromBank(loadSettings(), [])), liveCount: 0, sourcesUsed: [] };

  markSeen(final.questions);
  // ใช้แล้วทิ้ง เกมรอบหน้าต้องได้ชุดใหม่เสมอ
  cached = null;
  cachedKey = "";
  return final;
}

/** ทิ้งของที่เตรียมไว้ เช่นตอนแก้กติกาในหลังบ้าน */
export function resetPrefetch(): void {
  cached = null;
  cachedKey = "";
  inflight = null;
}
