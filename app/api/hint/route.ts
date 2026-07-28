import { NextResponse, type NextRequest } from "next/server";
import { getQuestionById } from "@/lib/questions";
import {
  generateFinalHints,
  generateSingleHint,
  getReveal,
  saveReveal,
} from "@/lib/hintEngine";
import type {
  HintApiRequest,
  HintApiResponse,
  HintMode,
  RevealApiResponse,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_MODES: HintMode[] = ["ตรง", "ลวง", "final"];

/**
 * POST /api/hint
 * body: { questionId, correctAnswer, hintType: "ตรง" | "ลวง" | "final" }
 *
 * ตอบกลับ: { revealId, hints: [{ id, text }], source }
 * ⚠️ label ว่าคำใบ้ไหน "จริง/หลอก" จะถูกเก็บไว้ฝั่งเซิร์ฟเวอร์เท่านั้น
 *    ดึงได้ผ่าน GET /api/hint?revealId=... ตอนเฉลย
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

    const stored = saveReveal(question.id, result.hints);

    const payload: HintApiResponse = {
      revealId: stored.revealId,
      // ตัด truth / mode / rationale ออกก่อนส่งให้ client
      hints: stored.hints.map(({ id, text }) => ({ id, text })),
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

/**
 * GET /api/hint?revealId=...
 * เฉลยว่าคำใบ้ชุดไหน "จริง" ชุดไหน "หลอก" พร้อมเหตุผลการออกแบบ
 * เรียกหลังหมดเวลา/จบข้อเท่านั้น
 */
export async function GET(request: NextRequest) {
  const revealId = request.nextUrl.searchParams.get("revealId");
  if (!revealId) {
    return NextResponse.json({ error: "ต้องระบุ revealId" }, { status: 400 });
  }

  const record = getReveal(revealId);
  if (!record) {
    return NextResponse.json(
      { error: "ไม่พบข้อมูลคำใบ้ชุดนี้ (อาจหมดอายุหรือเซิร์ฟเวอร์รีสตาร์ท)" },
      { status: 404 },
    );
  }

  const payload: RevealApiResponse = {
    revealId: record.revealId,
    questionId: record.questionId,
    hints: record.hints,
  };

  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
