import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  DRAFT_STALE_MS,
  MAX_DRAFT_LENGTH,
  MAX_INTENT_LENGTH,
  activeMembers,
  cleanName,
  cleanText,
  isRoomCode,
  normalizeRoomCode,
  retainedMembers,
  type RoomDraft,
  type RoomIntent,
  type RoomLive,
  type RoomMember,
  type RoomRecord,
  type RoomView,
} from "@/lib/room";
import {
  clearIntents,
  getRoom,
  listDrafts,
  listIntents,
  listSeen,
  pushIntent,
  saveDraft,
  restoreRoom,
  roomBackend,
  saveRoom,
  touchSeen,
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
 *      | "draft"   ส่งข้อความที่กำลังพิมพ์อยู่ให้คนอื่นเห็น (ยังไม่กดส่ง)
 *      | "clear"   เจ้าภาพล้างข้อเสนอที่อ่านแล้วทิ้ง
 *      | "leave"   ออกจากห้อง
 *      | "restore" เจ้าภาพปลุกห้องที่เซิร์ฟเวอร์ลืมไปกลับมา (ดู restoreRoom)
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

/**
 * `withDrafts` ต้องขอมาเป็นครั้ง ๆ ไม่ใช่ส่งให้ตลอด
 *
 * การอ่าน draft เพิ่ม HGETALL อีกหนึ่งคำสั่งต่อการ poll หนึ่งครั้ง ซึ่งเท่ากับ
 * +50% ของโควตา Redis ทั้งเกม (วัดไว้ว่าเกมหนึ่งกิน ~2,500 คำสั่ง)
 * ฝั่ง client จึงขอเฉพาะตอนที่กำลังตอบข้ออยู่จริง ช่วงเฉลย/ตรวจ/รอเริ่มไม่ต้องขอ
 */
async function buildView(room: RoomRecord, withDrafts = false): Promise<RoomView> {
  // ดึง hostId ออกทิ้งตรงนี้ที่เดียว — ดู RoomView ใน lib/room.ts ว่าทำไม
  const { hostId: _hostId, ...rest } = room;
  const now = Date.now();
  return {
    ...rest,
    members: activeMembers(await freshenSeen(room), now),
    intents: await listIntents(room.code),
    drafts: withDrafts
      ? (await listDrafts(room.code)).filter((d) => now - d.at < DRAFT_STALE_MS)
      : [],
    backend: roomBackend(),
  };
}

/**
 * เอาเวลาที่เห็นล่าสุดจาก key แยก มาทับค่าใน RoomRecord
 *
 * ค่าใน record เป็นแค่ค่าตอนเข้าห้อง ไม่ได้ถูกอัปเดตอีกเลย เพราะการ poll
 * ไม่เขียน record แล้ว (ดู seenKey ใน lib/roomStore.ts ว่าทำไมถึงต้องแยก)
 * ตัวจริงที่บอกว่าใครยังอยู่คือ hash ตัวนั้น จึงต้องรวมก่อนใช้งานทุกครั้ง
 */
async function freshenSeen(room: RoomRecord): Promise<RoomMember[]> {
  const seen = await listSeen(room.code);
  return room.members.map((m) =>
    seen[m.id] && seen[m.id] > m.lastSeen ? { ...m, lastSeen: seen[m.id] } : m,
  );
}

export async function GET(request: NextRequest, { params }: Params) {
  const code = await readCode(params);
  if (!code) return notFound();

  const room = await getRoom(code);
  if (!room) return notFound();

  /*
    บอกว่ายังอยู่ผ่าน key แยก ห้ามเขียน RoomRecord กลับไปจากตรงนี้เด็ดขาด
    ของเดิมเขียนกลับทั้งก้อน แล้วสำเนาเก่าของผู้ติดตามไปทับสแนปช็อตที่เจ้าภาพ
    เพิ่งเขียน จนผู้ติดตามค้างอยู่หน้า "รอเจ้าภาพเริ่มเกม" ตลอดกาล
  */
  const memberId = request.nextUrl.searchParams.get("memberId");
  if (memberId && room.members.some((m) => m.id === memberId)) {
    await touchSeen(code, memberId, Date.now());
  }
  const withDrafts = request.nextUrl.searchParams.get("drafts") === "1";
  return NextResponse.json(await buildView(room, withDrafts), noStore);
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
  room?: unknown;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ตรวจห้องที่เจ้าภาพส่งกลับมาปลุก — เชื่อฝั่ง client ไม่ได้ ต้องประกอบใหม่เองทั้งก้อน
 * ยอมรับเฉพาะรหัสที่ตรงกับ URL และ hostId ที่ตรงกับคนที่ยิงมา
 */
function sanitizeRestore(raw: unknown, code: string, hostId: string, now: number): RoomRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<RoomRecord>;
  if (r.code !== code || r.hostId !== hostId) return null;

  const members: RoomMember[] = Array.isArray(r.members)
    ? r.members
        .filter((m): m is RoomMember => Boolean(m) && typeof m === "object")
        .map((m) => ({
          id: UUID_PATTERN.test(String(m.id)) ? String(m.id) : "",
          name: cleanName(m.name) ?? "ผู้เล่น",
          isHost: m.id === hostId,
          // ตั้งเวลาที่เห็นล่าสุดเป็นตอนนี้ ไม่ใช่ค่าที่ client ส่งมา
          // เพราะทุกคนเพิ่งถูกปลุกกลับมาพร้อมกัน ไม่ควรโดนตัดออกทันที
          lastSeen: now,
        }))
        .filter((m) => m.id)
        .slice(0, 8)
    : [];

  if (!members.some((m) => m.id === hostId)) {
    members.unshift({ id: hostId, name: "เจ้าภาพ", isHost: true, lastSeen: now });
  }

  return {
    code,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : now,
    updatedAt: now,
    version: typeof r.version === "number" && r.version > 0 ? r.version : 1,
    hostId,
    members,
    snapshot: (r.snapshot as GameState | null) ?? null,
    live: (r.live as RoomRecord["live"]) ?? null,
  };
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

  const memberId = typeof body.memberId === "string" ? body.memberId : null;
  const now = Date.now();

  // ปลุกห้องคืนต้องทำก่อนด่าน 404 — เพราะทั้งจุดประสงค์ของมันคือตอนที่ห้องหายไปแล้ว
  if (body.op === "restore") {
    if (!memberId || !UUID_PATTERN.test(memberId)) {
      return NextResponse.json({ error: "ต้องเป็นเจ้าภาพเท่านั้น" }, { status: 403 });
    }
    const existing = await getRoom(code);
    if (existing) {
      // มีคนปลุกไปแล้ว หรือห้องไม่เคยหาย — ยึดของบนเซิร์ฟเวอร์เป็นหลัก ไม่ทับ
      return NextResponse.json(
        { restored: false, room: await buildView(existing) },
        noStore,
      );
    }
    const revived = sanitizeRestore(body.room, code, memberId, now);
    if (!revived) {
      return NextResponse.json({ error: "ข้อมูลห้องไม่ครบ ปลุกคืนไม่ได้" }, { status: 400 });
    }
    const ok = await restoreRoom(revived);
    const after = (await getRoom(code)) ?? revived;
    return NextResponse.json({ restored: ok, room: await buildView(after) }, noStore);
  }

  const room = await getRoom(code);
  if (!room) return notFound();

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
      // ต้องรวมเวลาจาก key แยกก่อน ไม่งั้นจะตัดคนที่ยัง poll อยู่ทิ้ง
      room.members = retainedMembers(await freshenSeen(room), now);
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
      // ต้องรวมเวลาจาก key แยกก่อน ไม่งั้นจะตัดคนที่ยัง poll อยู่ทิ้ง
      room.members = retainedMembers(await freshenSeen(room), now);
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

      // ตัวข้อเสนออยู่คนละ key อยู่แล้ว เหลือแค่บอกว่ายังอยู่ ซึ่งก็แยก key เหมือนกัน
      // ห้ามเขียน RoomRecord จากฝั่งผู้ติดตาม ด้วยเหตุผลเดียวกับใน GET
      await touchSeen(code, member.id, now);
      return NextResponse.json({ ok: true }, noStore);
    }

    case "draft": {
      const member = memberId ? room.members.find((m) => m.id === memberId) : undefined;
      if (!member) {
        return NextResponse.json({ error: "ยังไม่ได้เข้าห้องนี้" }, { status: 403 });
      }

      const draft: RoomDraft = {
        memberId: member.id,
        memberName: member.name,
        // ข้อความว่างเป็นค่าที่ถูกต้อง แปลว่า "ลบ draft ของฉันทิ้ง" ไม่ใช่ error
        text: cleanText(body.text, MAX_DRAFT_LENGTH) ?? "",
        questionId: typeof body.questionId === "string" ? body.questionId : null,
        at: now,
      };
      await saveDraft(code, draft);

      /**
       * ⚠️ ห้ามเรียก saveRoom() ใน op นี้ ทั้งที่ op อื่นเรียกกันหมด
       *
       * draft ถูกยิงถี่ (ทุกวินาทีระหว่างพิมพ์) ถ้าเขียน RoomRecord ตามไปด้วย
       * จะไปแข่งเขียนทับกับสแนปช็อตของเจ้าภาพที่ยิงพร้อมกันอยู่ ซึ่งเป็นเหตุผล
       * เดียวกับที่ draft ต้องแยก key ตั้งแต่แรก · ไม่อัปเดต lastSeen ด้วย
       * เพราะการ poll ปกติทำให้อยู่แล้ว
       */
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
