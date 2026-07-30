import type { GameState } from "./types";

/**
 * ห้องเล่นข้ามเครื่อง — ชนิดข้อมูลที่ใช้ร่วมกันทั้งฝั่ง client และ server
 *
 * โมเดลที่เลือกใช้คือ "เจ้าภาพถือสถานะ" (host-authoritative):
 *   - เครื่องที่กดเปิดห้องคือเจ้าภาพ รัน reducer เดิมใน lib/gameStore.tsx ตามปกติ
 *     แล้วส่งสแนปช็อต GameState ขึ้นห้องทุกครั้งที่สถานะเปลี่ยน
 *   - เครื่องอื่นดึงสแนปช็อตมาแสดง จึงเห็นคำถาม นาฬิกา กล่องคำใบ้ และคะแนนชุดเดียวกัน
 *   - เครื่องอื่นส่ง "ข้อเสนอ" (intent) กลับไปให้เจ้าภาพเห็นบนจอ
 *
 * เลือกแบบนี้เพราะตรรกะเกมทั้งหมด (การให้คะแนน โทเคน การแย่งตอบ) ไม่ต้องเขียนใหม่
 * แลกกับข้อจำกัดว่าเครื่องเจ้าภาพต้องเปิดค้างไว้ตลอดเกม
 */

export const ROOM_CODE_LENGTH = 5;

/** ตัด 0 O 1 I ออก เพราะอ่านผิดกันบ่อยเวลาบอกรหัสปากเปล่า */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/** ทำให้รหัสที่พิมพ์มาเป็นรูปแบบมาตรฐาน — ตัวใหญ่ ไม่มีช่องว่างหรือขีด */
export function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]/g, "");
}

export function isRoomCode(value: unknown): value is string {
  return typeof value === "string" && CODE_PATTERN.test(value);
}

export interface RoomMember {
  id: string;
  name: string;
  isHost: boolean;
  /** เวลาที่เห็นล่าสุด (epoch ms) — ใช้ตัดคนที่ปิดแท็บไปแล้วออกจากรายชื่อ */
  lastSeen: number;
}

export type RoomIntentKind = "suggest" | "requestBox";

/** ข้อความที่เพื่อนร่วมทีมส่งไปขึ้นบนจอเจ้าภาพ */
export interface RoomIntent {
  id: string;
  memberId: string;
  memberName: string;
  at: number;
  kind: RoomIntentKind;
  text: string;
  /** ผูกกับข้อไหน กันข้อเสนอของข้อเก่าค้างมาโผล่ในข้อใหม่ */
  questionId: string | null;
}

/**
 * สถานะ "สด" ของข้อที่กำลังเล่น
 *
 * แยกจาก GameState เพราะนาฬิกากับกล่องคำใบ้เป็น state ภายใน QuestionScreen
 * ไม่ได้อยู่ใน reducer — แต่ผู้ติดตามต้องเห็นด้วยถึงจะช่วยคิดทัน
 */
export interface RoomLiveBox {
  id: string;
  label: string;
  /** null = ยังไม่เปิดกล่องนี้ */
  text: string | null;
}

export interface RoomLive {
  questionId: string | null;
  /** epoch ms ที่หมดเวลา — ส่งเป็นเวลาปลายทางไม่ใช่วินาทีที่เหลือ จะได้ไม่เพี้ยนตามดีเลย์ */
  deadlineAt: number | null;
  boxes: RoomLiveBox[];
  /** ผู้เล่นที่ถึงตาตอบข้อนี้ */
  activeParticipantId: string | null;
  /** answering | grading | result — ใช้บอกผู้ติดตามว่ากำลังอยู่ช่วงไหนของข้อ */
  step: string;
}

export interface RoomRecord {
  code: string;
  createdAt: number;
  updatedAt: number;
  /** เพิ่มขึ้นทุกครั้งที่มีอะไรเปลี่ยน — client ใช้เทียบว่าต้องวาดใหม่ไหม */
  version: number;
  hostId: string;
  members: RoomMember[];
  snapshot: GameState | null;
  live: RoomLive | null;
}

export type RoomBackend = "redis" | "memory";

/**
 * สิ่งที่ส่งกลับไปให้ทุกเครื่องในห้อง — ตัด `hostId` ออกโดยตั้งใจ
 *
 * `hostId` ทำหน้าที่เป็นรหัสผ่านของเจ้าภาพ (ใช้ยืนยันตอน sync/clear/restore)
 * ถ้าส่งไปกับ view ผู้ติดตามทุกคนจะอ่านได้ แล้วยิงสถานะเกมปลอมขึ้นห้องได้เลย
 * ใครเป็นเจ้าภาพดูจาก `members[].isHost` แทนก็พอ
 */
export interface RoomView extends Omit<RoomRecord, "hostId"> {
  intents: RoomIntent[];
  /** สถานะที่เก็บของเซิร์ฟเวอร์ ใช้เตือนเมื่อยังไม่ได้ต่อ Redis */
  backend: RoomBackend;
}

/**
 * แยกสองเรื่องออกจากกัน:
 *   ONLINE — ใช้โชว์จุดเขียว "ใครอยู่ตอนนี้" เท่านั้น
 *   PRUNE  — ค่อยตัดออกจากห้องจริง ๆ
 *
 * เดิมใช้ค่าเดียวกันแล้วพัง เพราะเบราว์เซอร์หน่วง timer ของแท็บที่ไม่ได้อยู่หน้าจอ
 * คนที่สลับไปเปิดแท็บอื่นแป๊บเดียวจะถูกเตะออกถาวร แล้วส่งข้อความไม่ได้อีกเลย
 */
export const MEMBER_ONLINE_MS = 25_000;
export const MEMBER_PRUNE_MS = 10 * 60 * 1000;

/** ยังนับว่าออนไลน์อยู่ไหม — ใช้ตอนแสดงผล */
export function activeMembers(members: RoomMember[], now: number): RoomMember[] {
  return members.filter((m) => now - m.lastSeen < MEMBER_ONLINE_MS);
}

/** ยังเก็บไว้ในห้องไหม — ใช้ตอนเขียนลงที่เก็บข้อมูล */
export function retainedMembers(members: RoomMember[], now: number): RoomMember[] {
  return members.filter((m) => now - m.lastSeen < MEMBER_PRUNE_MS);
}

/** ลิงก์ที่ส่งให้เพื่อนร่วมทีม — เปิดแล้วเข้าห้องได้เลยไม่ต้องพิมพ์รหัส */
export function roomJoinUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/?room=${code}`;
}

export const MAX_NAME_LENGTH = 24;
export const MAX_INTENT_LENGTH = 200;

/**
 * ตัดอักขระควบคุมทิ้ง กันชื่อที่ทำให้ layout เพี้ยนหรือแอบแทรกบรรทัดใหม่
 * เทียบด้วยรหัสอักขระแทน regex เพื่อไม่ให้มีอักขระควบคุมจริงอยู่ในซอร์ส
 */
export function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? " " : ch;
  }
  const trimmed = out.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

export const cleanName = (value: unknown) => cleanText(value, MAX_NAME_LENGTH);
