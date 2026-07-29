import { NextResponse, type NextRequest } from "next/server";
import { critiquePerformance, type VoiceCritique } from "@/lib/voiceCoach";
import type { LlmChoiceInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/critique  { audio (base64), mimeType, task, rubric?, llm? }
 *   → { ok, critique } | { ok: false, reason }
 *
 * ฟังคลิปที่ผู้เล่นเพิ่งแสดงสด แล้วคืนฟีดแบ็กแบบโค้ช
 * ไม่ให้คะแนน — คนดูยังเป็นคนกดดาวเหมือนเดิม
 *
 * ตอบ 200 เสมอแม้ตอนล้มเหลว เพราะฟีดแบ็กเป็นของแถม
 * ถ้าตรงนี้พังแล้วไปบล็อกหน้าให้ดาว เกมจะค้างทั้งที่ยังเล่นต่อได้
 */

/** ตัวคลิปเป็น base64 จึงพองขึ้นราว 1.37 เท่า — 8MB ครอบคลุมคลิป 60 วินาทีสบาย ๆ */
const MAX_BODY_CHARS = 8 * 1024 * 1024;

interface RequestBody {
  audio?: string;
  mimeType?: string;
  task?: string;
  rubric?: string;
  llm?: LlmChoiceInput;
}

export interface CritiqueApiResponse {
  ok: boolean;
  critique?: VoiceCritique;
  reason?: string;
}

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, reason: "รูปแบบ JSON ไม่ถูกต้อง" }, { status: 400 });
  }

  const audio = typeof body.audio === "string" ? body.audio : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
  const task = typeof body.task === "string" ? body.task.slice(0, 2000) : "";

  if (!audio || !mimeType) {
    return NextResponse.json({ ok: false, reason: "ต้องส่งไฟล์เสียงมาด้วย" }, { status: 400 });
  }
  if (audio.length > MAX_BODY_CHARS) {
    return NextResponse.json({ ok: false, reason: "คลิปยาวเกินไป" }, { status: 413 });
  }

  const result = await critiquePerformance({
    audioBase64: audio,
    mimeType,
    task: task || "การแสดงสดบนเวที",
    rubric: typeof body.rubric === "string" ? body.rubric.slice(0, 1000) : undefined,
    llm: body.llm,
  });

  const payload: CritiqueApiResponse = result.ok
    ? { ok: true, critique: result.critique }
    : { ok: false, reason: result.reason };

  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
