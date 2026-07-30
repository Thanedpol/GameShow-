import { NextResponse } from "next/server";
import { pingStore, storeStatus } from "@/lib/roomStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/room/health — บอกว่าห้องเก็บไว้ที่ไหน และคุยกับที่เก็บนั้นได้จริงไหม
 *
 * มีไว้เพื่อไม่ให้ต้องเดาว่า "ใส่ env ไปแล้วมันติดหรือยัง" — กดปุ่มเดียวรู้เลย
 * ตอบเฉพาะสถานะ ไม่คืนค่า URL หรือ token ออกไป
 *
 * เส้นทางนี้เป็น segment คงที่ จึงชนะ /api/room/[code] ที่เป็น dynamic
 * (และ "health" ยาว 6 ตัวอักษร ไม่ผ่านรูปแบบรหัสห้อง 5 ตัวอยู่แล้ว)
 */
export async function GET() {
  const status = storeStatus();
  const ping = await pingStore();
  return NextResponse.json(
    {
      backend: status.backend,
      ok: status.backend === "redis" && ping.ok,
      detail: ping.ok ? ping.detail : status.reason || ping.detail,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
