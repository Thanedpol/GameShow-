import "server-only";

import { randomInt, randomUUID } from "node:crypto";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type RoomBackend,
  type RoomIntent,
  type RoomRecord,
} from "./room";

/**
 * ที่เก็บสถานะห้อง — สลับ backend ได้โดยไม่ต้องแก้โค้ดที่เรียกใช้
 *
 *   redis  — Upstash Redis ผ่าน REST API ใช้ได้จริงบน serverless
 *            เปิดใช้อัตโนมัติเมื่อเจอ env ของ Upstash/Vercel KV
 *   memory — เก็บใน process ใช้ตอนรัน dev ในเครื่องได้สบาย
 *
 * ⚠️ memory ใช้บน Vercel ไม่ได้จริง เพราะแต่ละ request อาจไปคนละ instance
 *    ห้องจะหายเป็นช่วง ๆ แบบสุ่ม — API จะบอก backend กลับไปให้ UI เตือนผู้ใช้
 *
 * จะย้ายไป Supabase/Pusher ทีหลังก็แก้แค่ไฟล์นี้ไฟล์เดียว
 */

const TTL_SECONDS = 6 * 60 * 60;
const MAX_INTENTS = 40;

function upstashConfig(): { url: string; token: string } | null {
  // รองรับทั้งชื่อของ Upstash ตรง ๆ และชื่อที่ Vercel KV ใส่ให้
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() || process.env.KV_REST_API_URL?.trim();
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || process.env.KV_REST_API_TOKEN?.trim();
  if (!url || !token) return null;
  // ต้องเป็น REST endpoint เท่านั้น — redis:// ใช้กับ fetch ไม่ได้
  if (!/^https?:\/\//i.test(url)) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

export function roomBackend(): RoomBackend {
  return upstashConfig() ? "redis" : "memory";
}

/**
 * อธิบายว่าทำไมถึงยังไม่ได้ใช้ Redis — เอาไปโชว์ในหลังบ้านและในกล่องเตือน
 *
 * กับดักที่เจอบ่อยคือคนก๊อป `REDIS_URL` (redis://...) หรือ `KV_URL` มาใส่
 * ซึ่งเป็นโปรโตคอล TCP ที่ fetch คุยไม่ได้ ต้องใช้คู่ REST เท่านั้น
 * ถ้าไม่บอกไว้ ระบบจะเงียบ ๆ ตกไปใช้หน่วยความจำโดยที่ผู้ใช้คิดว่าต่อ Redis แล้ว
 */
export function storeStatus(): { backend: RoomBackend; reason: string } {
  if (upstashConfig()) return { backend: "redis", reason: "" };

  const hasUrl = Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() || process.env.KV_REST_API_URL?.trim(),
  );
  const hasToken = Boolean(
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || process.env.KV_REST_API_TOKEN?.trim(),
  );
  const hasTcpOnly = Boolean(process.env.REDIS_URL?.trim() || process.env.KV_URL?.trim());

  let reason: string;
  if (hasUrl && !hasToken) reason = "มี URL แล้วแต่ยังไม่มี TOKEN";
  else if (!hasUrl && hasToken) reason = "มี TOKEN แล้วแต่ยังไม่มี URL";
  else if (hasUrl && hasToken) reason = "URL ที่ใส่ไม่ใช่ REST endpoint (ต้องขึ้นต้นด้วย https://)";
  else if (hasTcpOnly)
    reason = "เจอ REDIS_URL/KV_URL ซึ่งเป็นแบบ redis:// ใช้ไม่ได้ ต้องใช้คู่ REST แทน";
  else reason = "ยังไม่ได้ตั้งค่า UPSTASH_REDIS_REST_URL และ UPSTASH_REDIS_REST_TOKEN";

  return { backend: "memory", reason };
}

/** ยิงคำสั่งเบา ๆ เช็กว่าคุยกับ Redis ได้จริงไหม — ใช้ในปุ่มทดสอบการเชื่อมต่อ */
export async function pingStore(): Promise<{ ok: boolean; detail: string }> {
  const status = storeStatus();
  if (status.backend === "memory") return { ok: false, detail: status.reason };
  try {
    const pong = await redis<string>(["PING"]);
    return { ok: true, detail: `ต่อ Redis ได้ปกติ (${pong})` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Upstash REST
// ────────────────────────────────────────────────────────────────────────────

async function redis<T>(command: unknown[]): Promise<T> {
  const cfg = upstashConfig();
  if (!cfg) throw new Error("ยังไม่ได้ตั้งค่า Upstash Redis");

  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Redis HTTP ${res.status}: ${text.slice(0, 200)}`);
  return (JSON.parse(text) as { result: T }).result;
}

// ────────────────────────────────────────────────────────────────────────────
// หน่วยความจำใน process (ตอน dev)
// ────────────────────────────────────────────────────────────────────────────

interface MemoryEntry {
  room: RoomRecord;
  intents: RoomIntent[];
  expiresAt: number;
}

/**
 * ผูกไว้กับ globalThis เพราะ hot reload ของ Next.js สร้างโมดูลใหม่ทุกครั้งที่แก้ไฟล์
 * ถ้าเก็บใน module scope เฉย ๆ ห้องจะหายทุกครั้งที่เซฟโค้ดระหว่าง dev
 */
const memoryStore: Map<string, MemoryEntry> = ((
  globalThis as { __baijingRooms?: Map<string, MemoryEntry> }
).__baijingRooms ??= new Map());

function readMemory(code: string): MemoryEntry | null {
  const entry = memoryStore.get(code);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryStore.delete(code);
    return null;
  }
  return entry;
}

function touchMemory(entry: MemoryEntry): MemoryEntry {
  entry.expiresAt = Date.now() + TTL_SECONDS * 1000;
  return entry;
}

// ────────────────────────────────────────────────────────────────────────────
// API ที่ route เรียกใช้
// ────────────────────────────────────────────────────────────────────────────

const roomKey = (code: string) => `baijing:room:${code}`;
const intentKey = (code: string) => `baijing:room:${code}:intents`;

export async function getRoom(code: string): Promise<RoomRecord | null> {
  if (roomBackend() === "memory") return readMemory(code)?.room ?? null;

  const raw = await redis<string | null>(["GET", roomKey(code)]);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RoomRecord;
  } catch {
    return null;
  }
}

export async function saveRoom(room: RoomRecord): Promise<void> {
  if (roomBackend() === "memory") {
    const existing = readMemory(room.code);
    memoryStore.set(
      room.code,
      touchMemory({
        room,
        intents: existing?.intents ?? [],
        expiresAt: Date.now() + TTL_SECONDS * 1000,
      }),
    );
    return;
  }
  await redis(["SET", roomKey(room.code), JSON.stringify(room), "EX", TTL_SECONDS]);
}

/**
 * เขียนห้องกลับเข้าไป "เฉพาะตอนที่มันหายไปแล้ว" — ห้ามทับของที่มีอยู่
 *
 * ใช้ตอนเจ้าภาพเจอ 404 กลางเกมเพราะเซิร์ฟเวอร์ลืมห้องไป (รีสตาร์ท หรือ
 * instance ใหม่บน Vercel ตอนใช้โหมดหน่วยความจำ) เจ้าภาพถือสถานะจริงอยู่แล้ว
 * จึงส่งของทั้งก้อนกลับมาปลุกห้องเดิมด้วยรหัสเดิมได้
 *
 * เงื่อนไข "ห้ามทับ" สำคัญมาก ไม่งั้นใครก็ยิงทับห้องคนอื่นได้ถ้าเดารหัสถูก
 * และกันไม่ให้สแนปช็อตเก่าของเจ้าภาพที่เน็ตหน่วงย้อนไปทับของใหม่
 */
export async function restoreRoom(room: RoomRecord): Promise<boolean> {
  if (roomBackend() === "memory") {
    if (readMemory(room.code)) return false;
    memoryStore.set(room.code, {
      room,
      intents: [],
      expiresAt: Date.now() + TTL_SECONDS * 1000,
    });
    return true;
  }
  // NX = เขียนเฉพาะตอนที่ key ยังไม่มี ปล่อยให้ Redis ตัดสินแทนการอ่านแล้วเขียน
  // ซึ่งจะแข่งกันเองถ้ามีสองเครื่องยิงมาพร้อมกัน
  const res = await redis<string | null>([
    "SET",
    roomKey(room.code),
    JSON.stringify(room),
    "EX",
    TTL_SECONDS,
    "NX",
  ]);
  return res === "OK";
}

export async function deleteRoom(code: string): Promise<void> {
  if (roomBackend() === "memory") {
    memoryStore.delete(code);
    return;
  }
  await redis(["DEL", roomKey(code)]);
  await redis(["DEL", intentKey(code)]);
}

/**
 * ข้อเสนอเก็บแยกเป็น list ของตัวเอง ไม่ยัดรวมใน RoomRecord
 * เพราะเจ้าภาพเขียนสแนปช็อตทับตลอดเวลา ถ้าเก็บรวมกันข้อเสนอที่เพิ่งส่งจะโดนทับหาย
 */
export async function pushIntent(code: string, intent: RoomIntent): Promise<void> {
  if (roomBackend() === "memory") {
    const entry = readMemory(code);
    if (!entry) return;
    entry.intents.push(intent);
    if (entry.intents.length > MAX_INTENTS) {
      entry.intents.splice(0, entry.intents.length - MAX_INTENTS);
    }
    touchMemory(entry);
    return;
  }
  await redis(["RPUSH", intentKey(code), JSON.stringify(intent)]);
  await redis(["LTRIM", intentKey(code), -MAX_INTENTS, -1]);
  await redis(["EXPIRE", intentKey(code), TTL_SECONDS]);
}

export async function listIntents(code: string): Promise<RoomIntent[]> {
  if (roomBackend() === "memory") return readMemory(code)?.intents ?? [];

  const raw = await redis<string[] | null>(["LRANGE", intentKey(code), 0, -1]);
  return (raw ?? [])
    .map((line) => {
      try {
        return JSON.parse(line) as RoomIntent;
      } catch {
        return null;
      }
    })
    .filter((i): i is RoomIntent => i !== null);
}

export async function clearIntents(code: string): Promise<void> {
  if (roomBackend() === "memory") {
    const entry = readMemory(code);
    if (entry) entry.intents = [];
    return;
  }
  await redis(["DEL", intentKey(code)]);
}

// ────────────────────────────────────────────────────────────────────────────
// สร้างรหัสห้อง
// ────────────────────────────────────────────────────────────────────────────

function randomCode(): string {
  let out = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    out += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return out;
}

/** สุ่มจนกว่าจะได้รหัสที่ยังไม่มีใครใช้ — 32^5 ≈ 33 ล้านแบบ ชนกันยากมาก */
export async function createRoom(hostName: string): Promise<RoomRecord> {
  const hostId = randomUUID();
  const now = Date.now();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    if (await getRoom(code)) continue;

    const room: RoomRecord = {
      code,
      createdAt: now,
      updatedAt: now,
      version: 1,
      hostId,
      members: [{ id: hostId, name: hostName, isHost: true, lastSeen: now }],
      snapshot: null,
      live: null,
    };
    await saveRoom(room);
    return room;
  }
  throw new Error("สุ่มรหัสห้องไม่สำเร็จ ลองใหม่อีกครั้ง");
}
