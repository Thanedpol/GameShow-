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
    settings.imageCount,
    llm.provider,
    llm.model,
    // เปลี่ยนโมเดลของงาน "แต่งคำถาม" แล้วชุดที่เตรียมไว้ต้องถูกทิ้ง
    llm.taskModels.questions,
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

/**
 * ยิงแยกคำขอ "หนึ่งช่วงต่อหนึ่ง request" ขนานกัน
 *
 * เดิมส่งทั้งสามช่วงไปใน request เดียว ซึ่งแปลว่าทั้งเกมต้องเสร็จภายใน
 * `maxDuration = 60` วินาทีของ Vercel ก้อนเดียว วัดจริงหลังบังคับให้เฉลย
 * กางการคำนวณแล้วได้ 56.8 วิ — เหลือขอบเพียง 3 วินาที ซึ่งบนเซิร์ฟเวอร์จริง
 * ที่ช้ากว่าเครื่องเราจะทะลุแน่นอน แล้วผู้เล่นจะได้คำถามจากคลังสำรองทั้งเกม
 *
 * แยกเป็นสาม request แล้วแต่ละอันได้เวลา 60 วินาทีของตัวเอง ช่วงที่หนักสุด
 * ใช้ราว 43 วิ จึงมีขอบเหลือจริง และถ้าช่วงไหนล้ม ช่วงที่เหลือยังได้ของครบ
 * ไม่ใช่ล้มทั้งเกมเหมือนเดิม
 */
async function requestStage(
  settings: GameSettings,
  stage: (typeof STAGES)[number],
  avoid: string[],
  imageCount: number,
): Promise<QuestionsApiShape> {
  const res = await fetch("/api/questions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stages: [{ stage, count: settings.counts[stage], pointValue: settings.points[stage] }],
      groups: settings.feedGroups,
      avoid,
      imageCount,
      llm: llmRequestPayload("questions"),
    }),
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as QuestionsApiShape;
}

async function requestLive(settings: GameSettings): Promise<PreparedSet> {
  const stages = STAGES.filter((s) => settings.counts[s] > 0);
  const avoid = recentTopics(40);

  // กระจายโควตาภาพให้ทุกช่วง ไม่ให้กองอยู่ช่วงเดียวเหมือนตอนส่งรวมก้อนเดียว
  const perStage = Math.floor(settings.imageCount / Math.max(stages.length, 1));
  const extra = settings.imageCount - perStage * stages.length;

  const results = await Promise.allSettled(
    stages.map((stage, i) =>
      requestStage(settings, stage, avoid, perStage + (i < extra ? 1 : 0)),
    ),
  );

  const data = results
    .filter((r): r is PromiseFulfilledResult<QuestionsApiShape> => r.status === "fulfilled")
    .map((r) => r.value);

  // ข้อที่สร้างมาผ่านตัวตรวจฝั่งเซิร์ฟเวอร์แล้ว แต่ยังต้องกันคำถามที่เครื่องนี้เคยเจอ
  // เทียบด้วยลายนิ้วมือของตัวคำถาม ไม่ใช่ id — โมเดลเขียนประโยคเดียวกันด้วยคำต่างกันนิดหน่อยได้
  const seenFp = seenFingerprints();
  const live = data
    .flatMap((d) => d.questions ?? [])
    .filter(
      (q): q is Question =>
        Boolean(q) &&
        typeof (q as Question).prompt === "string" &&
        !seenFp.has(fingerprint((q as Question).prompt)),
    );

  return {
    questions: live,
    liveCount: live.length,
    sourcesUsed: [...new Set(data.flatMap((d) => d.sourcesUsed ?? []))],
  };
}

/**
 * รอบสอง — วาดภาพให้ข้อที่ขอไว้
 *
 * แยกเป็นอีก request เพราะการวาดกินเวลาเพิ่มอีก 10-15 วินาที
 * ถ้ารวมกับรอบแรกจะทะลุเพดาน 60 วินาทีของ Vercel
 * วาดไม่ได้ก็ปล่อยข้อนั้นเป็นคำถามข้อความธรรมดา ไม่ถือว่าล้มเหลว
 */
async function attachImages(questions: Question[]): Promise<Question[]> {
  const jobs = questions
    .filter((q) => q.imagePrompt)
    .map((q) => ({ id: q.id, prompt: q.imagePrompt! }));
  if (jobs.length === 0) return questions;

  try {
    const res = await fetch("/api/questions/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobs, llm: llmRequestPayload("image") }),
    });
    if (!res.ok) return questions;

    const data = (await res.json()) as { images?: Array<{ id: string; dataUrl: string | null }> };
    const byId = new Map((data.images ?? []).map((i) => [i.id, i.dataUrl]));
    return questions.map((q) => {
      const url = byId.get(q.id);
      // วาดไม่สำเร็จ → ถอด imagePrompt ทิ้ง ไม่งั้น UI จะรอภาพที่ไม่มีวันมา
      if (!url) return q.imagePrompt ? { ...q, imagePrompt: undefined } : q;
      return { ...q, imageUrl: url };
    });
  } catch {
    return questions.map((q) => (q.imagePrompt ? { ...q, imagePrompt: undefined } : q));
  }
}

async function prepare(settings: GameSettings): Promise<PreparedSet> {
  let live: PreparedSet = { questions: [], liveCount: 0, sourcesUsed: [] };

  if (settings.questionSource === "live") {
    try {
      live = await requestLive(settings);
      if (settings.imageCount > 0 && live.questions.length > 0) {
        live = { ...live, questions: await attachImages(live.questions) };
      }
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
