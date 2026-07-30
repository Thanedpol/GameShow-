import { NextResponse, type NextRequest } from "next/server";
import { getQuestionById } from "@/lib/questions";
import { generateHintBoxes, sealReveal } from "@/lib/hintEngine";
import { sanitizeQuestion } from "@/lib/settings";
import type { HintApiRequest, HintApiResponse } from "@/lib/types";
import { GUARD_RULES, guardApi } from "@/lib/apiGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// สร้าง 4 กล่องพร้อมกัน และโมเดลเปิด thinking อยู่
// ดีฟอลต์ 10 วินาทีของ Vercel ไม่พอ จะได้ 504 แทนคำใบ้
export const maxDuration = 60;

/**
 * POST /api/hint  { questionId }
 *   → { revealToken, boxes: [{ id, label, text }], source }
 *
 * กล่องคำใบ้มี 4 กล่อง มีทั้งจริงและหลอก อย่างน้อยอย่างละ 1 กล่อง
 * ⚠️ label จริง/หลอก ถูกเข้ารหัสอยู่ใน revealToken — client อ่านไม่ออก
 *
 * ฝั่ง client จะเรียก endpoint นี้ล่วงหน้าตั้งแต่ข้อเริ่ม เพื่อให้กดเปิดกล่องได้ทันที
 * โดยไม่กินเวลาจากนาฬิกา 60 วินาที
 */
export async function POST(request: NextRequest) {
  // ด่านกันเงินรั่ว — ต้องเป็นบรรทัดแรกของ handler ก่อนจะอ่าน body ด้วยซ้ำ
  // ไม่งั้นคนยิงถล่มจะได้ parse ก้อน 8MB ฟรีทุกคำขอ
  const blocked = await guardApi(request, GUARD_RULES.hint);
  if (blocked) return blocked;

  let body: Partial<HintApiRequest>;
  try {
    body = (await request.json()) as Partial<HintApiRequest>;
  } catch {
    return NextResponse.json({ error: "รูปแบบ JSON ไม่ถูกต้อง" }, { status: 400 });
  }

  const { questionId } = body;
  if (typeof questionId !== "string" || !questionId) {
    return NextResponse.json({ error: "ต้องระบุ questionId" }, { status: 400 });
  }

  // คลังตั้งต้นบนเซิร์ฟเวอร์มาก่อนเสมอ ถ้าไม่มีค่อยรับตัวข้อที่ client ส่งมา
  // (กรณีคำถามที่เพิ่ม/แก้จากหลังบ้าน ซึ่งเก็บอยู่ใน localStorage ของเบราว์เซอร์)
  const question =
    getQuestionById(questionId) ??
    sanitizeQuestion((body as { question?: unknown }).question);

  if (!question) {
    return NextResponse.json(
      { error: `ไม่พบคำถามรหัส ${questionId} และข้อมูลที่ส่งมาไม่ครบพอจะสร้างคำใบ้` },
      { status: 404 },
    );
  }

  try {
    // provider/model ที่หลังบ้านเลือกไว้ — เซิร์ฟเวอร์ตรวจ allowlist เองอีกชั้นใน resolveLlm
    const result = await generateHintBoxes(question, body.llm);
    const payload: HintApiResponse = {
      revealToken: sealReveal(question.id, result.boxes),
      // ตัด truth / rationale ออกก่อนส่งให้ client
      boxes: result.boxes.map(({ id, label, text, zone }) => ({ id, label, text, zone })),
      source: result.source,
    };
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[/api/hint] สร้างคำใบ้ไม่สำเร็จ:", error);
    return NextResponse.json(
      { error: "สร้างคำใบ้ไม่สำเร็จ กรุณาลองใหม่" },
      { status: 500 },
    );
  }
}
