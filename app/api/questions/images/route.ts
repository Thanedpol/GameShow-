import { NextResponse, type NextRequest } from "next/server";
import { drawQuestionImages, type ImageJob, type ImageResult } from "@/lib/imageGen";
import type { LlmChoiceInput } from "@/lib/types";
import { GUARD_RULES, guardApi } from "@/lib/apiGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/questions/images  { jobs: [{ id, prompt }], llm? }
 *   → { images: [{ id, dataUrl, reason? }] }
 *
 * แยกจาก /api/questions เพราะการวาดภาพใช้เวลาเพิ่มอีกราว 10-15 วินาที
 * ถ้ารวมอยู่ใน request เดียวกันจะเกินเพดาน 60 วินาทีของ Vercel
 * ฝั่ง client จึงขอข้อความก่อน แล้วค่อยตามด้วยภาพเป็นรอบที่สอง
 *
 * วาดไม่ได้ก็ไม่เป็นไร — คำถามยังเล่นได้โดยไม่มีภาพ
 */

/** เพดานกันยิงขอทีละร้อยภาพ ภาพละ ~2.4 บาท จึงต้องล็อกให้แน่น */
const MAX_JOBS = 10;
const MAX_PROMPT_CHARS = 1200;

interface RequestBody {
  jobs?: Array<{ id?: string; prompt?: string }>;
  llm?: LlmChoiceInput;
}

export interface QuestionImagesApiResponse {
  images: ImageResult[];
  blocked?: string;
}

export async function POST(request: NextRequest) {
  // ด่านกันเงินรั่ว — ต้องเป็นบรรทัดแรกของ handler ก่อนจะอ่าน body ด้วยซ้ำ
  // ไม่งั้นคนยิงถล่มจะได้ parse ก้อน 8MB ฟรีทุกคำขอ
  const blocked = await guardApi(request, GUARD_RULES.images);
  if (blocked) return blocked;

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "รูปแบบ JSON ไม่ถูกต้อง" }, { status: 400 });
  }

  const jobs: ImageJob[] = (Array.isArray(body.jobs) ? body.jobs : [])
    .filter((j) => typeof j?.id === "string" && typeof j?.prompt === "string")
    .slice(0, MAX_JOBS)
    .map((j) => ({
      id: String(j.id).slice(0, 120),
      prompt: String(j.prompt).slice(0, MAX_PROMPT_CHARS),
    }))
    .filter((j) => j.prompt.trim().length > 10);

  if (jobs.length === 0) {
    return NextResponse.json({ images: [] } satisfies QuestionImagesApiResponse, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const outcome = await drawQuestionImages({ jobs, llm: body.llm });
    const payload: QuestionImagesApiResponse = {
      images: outcome.images,
      blocked: outcome.blocked,
    };
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[/api/questions/images] วาดภาพไม่สำเร็จ:", error);
    return NextResponse.json(
      { images: [], blocked: String(error).slice(0, 200) } satisfies QuestionImagesApiResponse,
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
