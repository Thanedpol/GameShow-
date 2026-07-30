import { NextResponse, type NextRequest } from "next/server";
import { transcribeAudio } from "@/lib/transcribe";
import type { LlmChoiceInput } from "@/lib/types";
import { GUARD_RULES, guardApi } from "@/lib/apiGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/transcribe  { audio (base64), mimeType, llm? }
 *   → { ok, text } | { ok: false, reason }
 *
 * ทางสำรองของปุ่มไมค์ สำหรับเบราว์เซอร์ที่ไม่มี Web Speech API
 * ตอบ 200 เสมอ เพราะผู้เล่นยังพิมพ์เองได้ ถ้าตรงนี้พังไม่ควรไปบล็อกการตอบ
 */

/** คลิปตอบคำถามยาวสุดราว 60 วินาที — base64 พองขึ้น 1.37 เท่า เผื่อไว้ 8MB */
const MAX_BODY_CHARS = 8 * 1024 * 1024;

interface RequestBody {
  audio?: string;
  mimeType?: string;
  llm?: LlmChoiceInput;
}

export interface TranscribeApiResponse {
  ok: boolean;
  text?: string;
  reason?: string;
}

export async function POST(request: NextRequest) {
  // ด่านกันเงินรั่ว — ต้องเป็นบรรทัดแรกของ handler ก่อนจะอ่าน body ด้วยซ้ำ
  // ไม่งั้นคนยิงถล่มจะได้ parse ก้อน 8MB ฟรีทุกคำขอ
  const blocked = await guardApi(request, GUARD_RULES.voice);
  if (blocked) return blocked;

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, reason: "รูปแบบ JSON ไม่ถูกต้อง" }, { status: 400 });
  }

  const audio = typeof body.audio === "string" ? body.audio : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
  if (!audio || !mimeType) {
    return NextResponse.json({ ok: false, reason: "ต้องส่งไฟล์เสียงมาด้วย" }, { status: 400 });
  }
  if (audio.length > MAX_BODY_CHARS) {
    return NextResponse.json({ ok: false, reason: "คลิปยาวเกินไป" }, { status: 413 });
  }

  const result = await transcribeAudio({ audioBase64: audio, mimeType, llm: body.llm });
  const payload: TranscribeApiResponse = result.ok
    ? { ok: true, text: result.text }
    : { ok: false, reason: result.reason };

  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
