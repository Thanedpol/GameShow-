import { NextResponse, type NextRequest } from "next/server";
import { getQuestionById } from "@/lib/questions";
import { gradeOpenAnswer } from "@/lib/hintEngine";
import { sanitizeQuestion } from "@/lib/settings";
import { MAX_ANSWER_LENGTH } from "@/lib/types";
import type { GradeApiRequest, GradeApiResponse } from "@/lib/types";
import { GUARD_RULES, guardApi } from "@/lib/apiGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/grade  { questionId, answer }
 *   → { score: 0-100, feedback, strengths[], improvements[], source }
 *
 * ใช้กับคำถามอัตนัย — ให้โมเดลที่เลือกไว้ในหลังบ้านตรวจตาม rubric ของข้อนั้น
 * ถ้ายังไม่ได้ตั้งคีย์หรือเรียกโมเดลไม่สำเร็จ จะตกไปใช้การประเมินหยาบ ๆ ในเครื่องแทน
 */
export async function POST(request: NextRequest) {
  // ด่านกันเงินรั่ว — ต้องเป็นบรรทัดแรกของ handler ก่อนจะอ่าน body ด้วยซ้ำ
  // ไม่งั้นคนยิงถล่มจะได้ parse ก้อน 8MB ฟรีทุกคำขอ
  const blocked = await guardApi(request, GUARD_RULES.grade);
  if (blocked) return blocked;

  let body: Partial<GradeApiRequest>;
  try {
    body = (await request.json()) as Partial<GradeApiRequest>;
  } catch {
    return NextResponse.json({ error: "รูปแบบ JSON ไม่ถูกต้อง" }, { status: 400 });
  }

  const { questionId, answer } = body;
  if (typeof questionId !== "string" || !questionId) {
    return NextResponse.json({ error: "ต้องระบุ questionId" }, { status: 400 });
  }

  /**
   * ปฏิเสธไปเลย ไม่ตัดให้สั้นแล้วตรวจต่อ
   *
   * ช่องพิมพ์คำตอบจริงจำกัดที่ MAX_ANSWER_LENGTH อยู่แล้ว (ทั้ง maxLength ของ
   * textarea และตอนต่อข้อความจากไมค์) คำตอบที่ยาวเกินนี้จึงเป็นไปไม่ได้จากการ
   * เล่นปกติ — มาจากการยิง API ตรงเท่านั้น
   *
   * ที่เลือกปฏิเสธแทนการตัด เพราะถ้าตัดแล้วตรวจต่อ ผู้เล่นที่เขียนยาวจะโดนตัด
   * ท้ายทิ้งเงียบ ๆ แล้วได้คะแนนต่ำกว่าที่ควร ซึ่งผิดข้อกำหนดว่าห้ามให้คะแนน
   * ผิดไปจากคำตอบจริง
   */
  if (typeof answer === "string" && answer.length > MAX_ANSWER_LENGTH) {
    return NextResponse.json(
      { error: `คำตอบยาวเกิน ${MAX_ANSWER_LENGTH} ตัวอักษร` },
      { status: 400 },
    );
  }

  const question =
    getQuestionById(questionId) ??
    sanitizeQuestion((body as { question?: unknown }).question);

  if (!question) {
    return NextResponse.json({ error: "ไม่พบคำถามในคลัง" }, { status: 404 });
  }

  try {
    const result = await gradeOpenAnswer(
      question,
      typeof answer === "string" ? answer : "",
      body.llm,
    );
    const payload: GradeApiResponse = result;
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[/api/grade] ตรวจคำตอบไม่สำเร็จ:", error);
    return NextResponse.json({ error: "ตรวจคำตอบไม่สำเร็จ" }, { status: 500 });
  }
}
