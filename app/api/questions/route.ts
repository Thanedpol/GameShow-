import { NextResponse, type NextRequest } from "next/server";
import { generateQuestions, type StageRequest } from "@/lib/questionGen";
import { FEED_GROUPS, type FeedGroup } from "@/lib/sources";
import type { LlmChoiceInput, Question, Stage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// ดึงข่าว + ให้โมเดลแต่งคำถามพร้อมคำใบ้ 6 อันต่อข้อ
// ดีฟอลต์ 10 วินาทีของ Vercel ไม่พอแน่นอน
export const maxDuration = 60;

/**
 * POST /api/questions
 * body: { stages: [{ stage, count, pointValue }], groups?, avoid?, llm? }
 *   → { questions, shortfall, source, sourcesUsed, feedsFailed }
 *
 * ชุดคำถามของ 1 เกม แต่งสดจากข่าว/บทความจริงที่ดึงมาตอนนั้น
 *
 * ฝั่ง client เรียกล่วงหน้าตั้งแต่ผู้เล่นยังอยู่หน้าตั้งค่า พอกดเริ่มเกมจึงได้เล่นทันที
 * ถ้าที่นี่คืนไม่ครบ (ไม่มีคีย์ / ฟีดล่ม / โมเดลแต่งไม่ผ่านตัวตรวจ) ฝั่ง client
 * จะเติมส่วนที่ขาดจากคลังในเครื่องเอง เกมจึงเริ่มได้เสมอ
 */

const VALID_STAGES: Stage[] = ["warmup", "push", "final"];

/** เพดานกันคนยิง request ขอทีละพันข้อจนเปลืองโทเคน */
const MAX_PER_STAGE = 15;
const MAX_AVOID = 60;

interface RequestBody {
  stages?: Array<{ stage?: string; count?: number; pointValue?: number }>;
  groups?: string[];
  avoid?: string[];
  llm?: LlmChoiceInput;
}

export interface QuestionsApiResponse {
  questions: Question[];
  /** ช่วงไหนได้ไม่ครบ — ตัวเลขคือจำนวนที่ยังขาด */
  shortfall: Record<string, number>;
  source: "llm" | "fallback";
  /** ชื่อสำนักข่าวที่ดึงมาได้จริง ใช้โชว์ในหลังบ้านตอนไล่ปัญหา */
  sourcesUsed: string[];
  feedsFailed: string[];
}

function parseStages(input: RequestBody["stages"]): StageRequest[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<Stage>();
  const out: StageRequest[] = [];
  for (const raw of input) {
    const stage = VALID_STAGES.find((s) => s === raw?.stage);
    if (!stage || seen.has(stage)) continue;
    const count = Math.min(MAX_PER_STAGE, Math.max(0, Math.floor(Number(raw?.count) || 0)));
    if (count === 0) continue;
    seen.add(stage);
    out.push({
      stage,
      count,
      pointValue: Math.min(100_000, Math.max(0, Math.floor(Number(raw?.pointValue) || 100))),
    });
  }
  return out;
}

/** กลุ่มฟีดต้องอยู่ใน allowlist — client ระบุ URL เองไม่ได้ กัน SSRF */
function parseGroups(input: RequestBody["groups"]): FeedGroup[] {
  if (!Array.isArray(input)) return FEED_GROUPS;
  const picked = input.filter((g): g is FeedGroup =>
    (FEED_GROUPS as string[]).includes(g as string),
  );
  return picked.length > 0 ? picked : FEED_GROUPS;
}

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "รูปแบบ JSON ไม่ถูกต้อง" }, { status: 400 });
  }

  const stages = parseStages(body.stages);
  if (stages.length === 0) {
    return NextResponse.json({ error: "ต้องระบุ stages อย่างน้อย 1 ช่วง" }, { status: 400 });
  }

  const avoid = Array.isArray(body.avoid)
    ? body.avoid
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().slice(0, 120))
        .filter((t) => t.length > 0)
        .slice(0, MAX_AVOID)
    : [];

  try {
    const result = await generateQuestions({
      stages,
      groups: parseGroups(body.groups),
      avoid,
      llm: body.llm,
    });

    const payload: QuestionsApiResponse = {
      questions: result.questions,
      shortfall: result.shortfall,
      source: result.questions.length > 0 ? "llm" : "fallback",
      sourcesUsed: result.sourcesUsed,
      feedsFailed: result.feedsFailed,
    };
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[/api/questions] สร้างคำถามไม่สำเร็จ:", error);
    // ไม่คืน 500 เพราะฝั่ง client มีคลังในเครื่องรออยู่แล้ว
    // ตอบ 200 พร้อมชุดว่างจะทำให้เกมเริ่มได้ทันทีโดยไม่ต้องรอ retry
    const payload: QuestionsApiResponse = {
      questions: [],
      shortfall: Object.fromEntries(stages.map((s) => [s.stage, s.count])),
      source: "fallback",
      sourcesUsed: [],
      feedsFailed: [],
    };
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  }
}
