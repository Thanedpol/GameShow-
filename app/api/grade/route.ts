import { NextResponse, type NextRequest } from "next/server";
import { getQuestionById } from "@/lib/questions";
import { gradeOpenAnswer } from "@/lib/hintEngine";
import { sanitizeQuestion } from "@/lib/settings";
import type { GradeApiRequest, GradeApiResponse } from "@/lib/types";

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
