import { NextResponse, type NextRequest } from "next/server";
import { cleanName, type RoomBackend } from "@/lib/room";
import { createRoom, roomBackend } from "@/lib/roomStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/room  { name }
 *   → { code, memberId, backend }
 *
 * คนที่เรียก endpoint นี้จะกลายเป็น "เจ้าภาพ" ของห้อง
 * memberId ที่ได้กลับไปคือตัวตนในห้อง ต้องเก็บไว้ส่งมาทุกครั้งที่เรียก API ห้อง
 */

export interface CreateRoomResponse {
  code: string;
  memberId: string;
  backend: RoomBackend;
}

export async function POST(request: NextRequest) {
  let body: { name?: unknown };
  try {
    body = (await request.json()) as { name?: unknown };
  } catch {
    return NextResponse.json({ error: "รูปแบบ JSON ไม่ถูกต้อง" }, { status: 400 });
  }

  const name = cleanName(body.name);
  if (!name) {
    return NextResponse.json({ error: "ต้องระบุชื่อผู้เปิดห้อง" }, { status: 400 });
  }

  try {
    const room = await createRoom(name);
    const payload: CreateRoomResponse = {
      code: room.code,
      memberId: room.hostId,
      backend: roomBackend(),
    };
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[/api/room] เปิดห้องไม่สำเร็จ:", error);
    return NextResponse.json({ error: "เปิดห้องไม่สำเร็จ" }, { status: 500 });
  }
}
