import { NextResponse, type NextRequest } from "next/server";
import { openReveal } from "@/lib/hintEngine";
import type { RevealApiRequest, RevealApiResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/reveal
 * body: { revealToken }
 *
 * เฉลยว่าคำใบ้ชุดไหน "จริง" ชุดไหน "หลอก" พร้อมเหตุผลการออกแบบ
 * เรียกหลังจบข้อ / หมดเวลารอบ Final เท่านั้น
 *
 * ใช้ POST แทน GET เพราะ token มีขนาดหลัก KB — ยัดใส่ query string ไม่เหมาะ
 * และการถอดรหัสเป็น stateless จึงทำงานได้ทุก instance บน serverless
 */
export async function POST(request: NextRequest) {
  let body: Partial<RevealApiRequest>;
  try {
    body = (await request.json()) as Partial<RevealApiRequest>;
  } catch {
    return NextResponse.json({ error: "รูปแบบ JSON ไม่ถูกต้อง" }, { status: 400 });
  }

  const { revealToken } = body;
  if (typeof revealToken !== "string" || !revealToken) {
    return NextResponse.json({ error: "ต้องระบุ revealToken" }, { status: 400 });
  }

  const payload = openReveal(revealToken);
  if (!payload) {
    return NextResponse.json(
      { error: "token ไม่ถูกต้องหรือหมดอายุแล้ว" },
      { status: 400 },
    );
  }

  const response: RevealApiResponse = {
    questionId: payload.questionId,
    hints: payload.hints,
  };

  return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
}
