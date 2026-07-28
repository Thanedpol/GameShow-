import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  MAX_INTENT_LENGTH,
  activeMembers,
  cleanName,
  cleanText,
  isRoomCode,
  normalizeRoomCode,
  retainedMembers,
  type RoomIntent,
  type RoomLive,
  type RoomMember,
  type RoomRecord,
  type RoomView,
} from "@/lib/room";
import {
  clearIntents,
  getRoom,
  listIntents,
  pushIntent,
  roomBackend,
  saveRoom,
} from "@/lib/roomStore";
import type { GameState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/room/[code]?memberId=...   ดึงสถานะห้องล่าสุด (พร้อมต่ออายุ lastSeen)
 * POST /api/room/[code]  { op, memberId, ... }
 *   op = "join"    เข้าห้อง (หรือกลับเข้ามาใหม่ด้วย memberId เดิม)
 *      | "sync"    เจ้าภาพส่งสแนปช็อตสถานะเกมขึ้นห้อง
 *      | "intent"  ผู้เล่นอื่นส่งข้อเสนอไปขึ้นจอเจ้าภาพ
 *      | "clear"   เจ้าภาพล้างข้อเสนอที่อ่านแล้วทิ้ง
 *      | "leave"   ออกจากห้อง
 */

type Params = { params: Promise<{ code: string }> };

function notFound() {
  return NextResponse.json({ error: "ไม่พบห้องนี้ หรือห้องหมดอายุแล้ว" }, { status: 404 });
}

const noStore = { headers: { "Cache-Control": "no-store" } };

async function readCode(params: Params["params"]): Promise<string | null> {
  const { code } = await params;
  const normalized = normalizeRoomCode(code ?? "");
  return isRoomCode(normalized) ? normalized : null;
}

async function buildView(room: RoomRecord): Promise<RoomView> {
  return {
    ...room,
    members: activeMembers(room.members, Date.now()),
    intents: await listIntents(room.code),
    backend: roomBackend(),
  };
}

/** ต่ออายุ lastSeen ของสมาชิก แล้วบอกว่ามีอะไรเปลี่ยนพอที่จะต้องเขียนกลับไหม */
function touchMember(room: RoomRecord, memberId: string | null): boolean {
  if (!memberId) return false;
  const member = room.members.find((m) => m.id === memberId);
  if (!member) return false;
  const now = Date.now();
  // เขียนกลับเฉพาะตอนที่ห่างพอสมควร ไม่งั้นทุก ๆ การ poll จะยิงเขียน Redis
  if (now - member.lastSeen < 5_000) return false;
  member.lastSeen = now;
  return true;
}

export async function GET(request: NextRequest, { params }: Params) {
  const code = await readCode(params);
  if (!code) return notFound();

  const room = await getRoom(code);
  if (!room) return notFound();

  if (touchMember(room, request.nextUrl.searchParams.get("memberId"))) {
    await saveRoom(room);
  }
  return NextResponse.json(await buildView(room), noStore);
}

interface OpBody {
  op?: string;
  memberId?: unknown;
  name?: unknown;
  snapshot?: unknown;
  live?: unknown;
  text?: unknown;
  kind?: unknown;
  questionId?: unknown;
}

export async function POST(request: NextRequest, { params }: Params) {
  const code = await readCode(params);
  if (!code) return notFound();

  let body: OpBody;
  try {
    body = (await request.json()) as OpBody;
  } catch {
    return NextResponse.json({ error: "รูปแบบ JSON ไม่ถูกต้อง" }, { status: 400 });
  }

  const room = await getRoom(code);
  if (!room) return notFound();

  const memberId = typeof body.memberId === "string" ? body.memberId : null;
  const now = Date.now();

  switch (body.op) {
    case "join": {
      const name = cleanName(body.name);
      if (!name) {
        return NextResponse.json({ error: "ต้องระบุชื่อ" }, { status: 400 });
      }

      // กลับเข้ามาใหม่ด้วย memberId เดิม (เช่นรีเฟรชหน้า) ให้ใช้ที่นั่งเดิม
      const existing = memberId ? room.members.find((m) => m.id === memberId) : undefined;
      let id: string;
      if (existing) {
        existing.name = name;
        existing.lastSeen = now;
        id = existing.id;
      } else {
        if (activeMembers(room.members, now).length >= 8) {
          return NextResponse.json({ error: "ห้องนี้เต็มแล้ว (สูงสุด 8 คน)" }, { status: 409 });
        }
        const member: RoomMember = { id: randomUUID(), name, isHost: false, lastSeen: now };
        room.members.push(member);
        id = member.id;
      }

      // เก็บเฉพาะคนที่ยังอยู่ กันรายชื่อบวมจากคนที่ปิดแท็บไปนานแล้ว
      room.members = retainedMembers(room.members, now);
      room.updatedAt = now;
      room.version += 1;
      await saveRoom(room);
      return NextResponse.json({ memberId: id, room: await buildView(room) }, noStore);
    }

    case "sync": {
      if (memberId !== room.hostId) {
        return NextResponse.json(
          { error: "มีแค่เครื่องเจ้าภาพที่ส่งสถานะเกมได้" },
          { status: 403 },
        );
      }
      // ส่งมาแค่ field ไหน ก็อัปเดตแค่ field นั้น เพราะ state กับสถานะสด
      // ถูกส่งคนละจังหวะกัน (state มาจาก reducer ส่วนสถานะสดมาจากหน้าจอข้อ)
      if ("snapshot" in body) room.snapshot = (body.snapshot as GameState | null) ?? null;
      if ("live" in body) room.live = (body.live as RoomLive | null) ?? null;
      // ตัดเฉพาะคนที่หายไปนานจริง ๆ — ห้ามใช้เกณฑ์ "ออนไลน์" ตรงนี้
      // ไม่งั้นเจ้าภาพที่ sync ถี่ ๆ จะเตะเพื่อนที่แท็บโดนหน่วงออกจากห้อง
      room.members = retainedMembers(room.members, now);
      const host = room.members.find((m) => m.id === room.hostId);
      if (host) host.lastSeen = now;
      room.updatedAt = now;
      room.version += 1;
      await saveRoom(room);
      return NextResponse.json({ version: room.version }, noStore);
    }

    case "intent": {
      const member = memberId ? room.members.find((m) => m.id === memberId) : undefined;
      if (!member) {
        return NextResponse.json({ error: "ยังไม่ได้เข้าห้องนี้" }, { status: 403 });
      }
      const text = cleanText(body.text, MAX_INTENT_LENGTH);
      if (!text) {
        return NextResponse.json({ error: "ข้อความว่างเปล่า" }, { status: 400 });
      }

      const intent: RoomIntent = {
        id: randomUUID(),
        memberId: member.id,
        memberName: member.name,
        at: now,
        kind: body.kind === "requestBox" ? "requestBox" : "suggest",
        text,
        questionId: typeof body.questionId === "string" ? body.questionId : null,
      };
      await pushIntent(code, intent);

      member.lastSeen = now;
      room.updatedAt = now;
      room.version += 1;
      await saveRoom(room);
      return NextResponse.json({ ok: true }, noStore);
    }

    case "clear": {
      if (memberId !== room.hostId) {
        return NextResponse.json({ error: "มีแค่เครื่องเจ้าภาพที่ล้างได้" }, { status: 403 });
      }
      await clearIntents(code);
      room.updatedAt = now;
      room.version += 1;
      await saveRoom(room);
      return NextResponse.json({ ok: true }, noStore);
    }

    case "leave": {
      room.members = room.members.filter((m) => m.id !== memberId);
      room.updatedAt = now;
      room.version += 1;
      await saveRoom(room);
      return NextResponse.json({ ok: true }, noStore);
    }

    default:
      return NextResponse.json({ error: `ไม่รู้จักคำสั่ง ${body.op}` }, { status: 400 });
  }
}
