import { NextResponse, type NextRequest } from "next/server";
import { getQuestionById } from "@/lib/questions";
import { generateFinalHints, generateSingleHint, sealReveal } from "@/lib/hintEngine";
import type { HintApiRequest, HintApiResponse, HintMode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// รอบ final ยิง Claude 3 คำขอพร้อมกัน และโมเดลเปิด thinking อยู่
// ดีฟอลต์ของ Vercel (10 วิ) ไม่พอ จะได้ 504 แทนคำใบ้
export const maxDuration = 60;

const VALID_MODES: HintMode[] = ["ตรง", "ลวง", "final"];

/**
 * POST /api/hint
 * body: { questionId, correctAnswer, hintType: "ตรง" | "ลวง" | "final" }
 *
 * ตอบกลับ: { revealToken, hints: [{ id, text }], source }
 * ⚠️ label ว่าคำใบ้ไหน "จริง/หลอก" ถูกเข้ารหัสไว้ใน revealToken
 *    client อ่านไม่ออก — ต้องส่งกลับไปที่ POST /api/reveal เพื่อขอเฉลย
 */
export async function POST(request: NextRequest) {
  let body: Partial<HintApiRequest>;
  try {
    body = (await request.json()) as Partial<HintApiRequest>;
  } catch {
    return NextResponse.json({ error: "รูปแบบ JSON ไม่ถูกต้อง" }, { status: 400 });
  }

  const { questionId, correctAnswer, hintType } = body;

  if (typeof questionId !== "string" || !questionId) {
    return NextResponse.json({ error: "ต้องระบุ questionId" }, { status: 400 });
  }
  if (!hintType || !VALID_MODES.includes(hintType)) {
    return NextResponse.json(
      { error: 'hintType ต้องเป็น "ตรง", "ลวง" หรือ "final"' },
      { status: 400 },
    );
  }

  const question = getQuestionById(questionId);
  if (!question) {
    return NextResponse.json(
      { error: `ไม่พบคำถามรหัส ${questionId} ในคลัง` },
      { status: 404 },
    );
  }

  // ใช้คำตอบจากคลังฝั่งเซิร์ฟเวอร์เป็นหลัก (กัน client ส่งค่าเพี้ยนมา)
  if (
    typeof correctAnswer === "string" &&
    correctAnswer.length > 0 &&
    correctAnswer !== question.correctAnswer
  ) {
    return NextResponse.json(
      { error: "correctAnswer ไม่ตรงกับคลังคำถามฝั่งเซิร์ฟเวอร์" },
      { status: 400 },
    );
  }

  try {
    const result =
      hintType === "final"
        ? await generateFinalHints(question, question.correctAnswer)
        : await generateSingleHint(question, question.correctAnswer, hintType);

    const payload: HintApiResponse = {
      revealToken: sealReveal(question.id, result.hints),
      // ตัด truth / mode / rationale ออกก่อนส่งให้ client
      hints: result.hints.map(({ id, text }) => ({ id, text })),
      source: result.source,
    };

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[/api/hint] สร้างคำใบ้ไม่สำเร็จ:", error);
    return NextResponse.json(
      { error: "สร้างคำใบ้ไม่สำเร็จ กรุณาลองใหม่" },
      { status: 500 },
    );
  }
}
