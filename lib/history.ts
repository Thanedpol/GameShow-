import type { Question } from "./types";

/**
 * ความจำว่า "เคยเจอคำถามนี้แล้ว"
 *
 * เก็บใน localStorage เหมือนของอย่างอื่นในโปรเจกต์นี้ (ไม่มีฐานข้อมูลตามสเปก)
 * ผลคือความจำผูกกับเบราว์เซอร์เครื่องนั้น — โหมดทีมข้ามเครื่องใช้ความจำของ
 * เครื่องเจ้าภาพ เพราะเจ้าภาพเป็นคนสุ่ม/สร้างคำถามแล้วส่งสแนปช็อตไปให้ทุกคน
 *
 * เก็บแค่ลายนิ้วมือ (hash) ไม่เก็บตัวคำถามเต็ม เพราะต้องการแค่รู้ว่า "ซ้ำไหม"
 * และไม่อยากให้ localStorage บวมจนกระทบเวลาโหลด
 */

const SEEN_KEY = "baijing.seen.v1";
const MAX_ENTRIES = 400;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const isBrowser = () => typeof window !== "undefined";

export interface SeenEntry {
  /** ลายนิ้วมือของตัวคำถาม */
  fp: string;
  /** id ของข้อ — ใช้กรองตอนสุ่มจากคลังในเครื่อง */
  id: string;
  /** หัวข้อสั้น ๆ ไว้ส่งให้ตัวสร้างคำถามเป็นรายการ "ห้ามซ้ำ" */
  topic: string;
  at: number;
}

/**
 * ตัดช่องว่าง วรรคตอน และอักขระที่ไม่ใช่ตัวอักษร/ตัวเลขออกก่อน hash
 * คำถามที่ต่างกันแค่เครื่องหมายหรือการเว้นวรรคจะได้ค่าเดียวกัน
 */
export function fingerprint(prompt: string): string {
  const normalized = prompt
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 300);

  // djb2 — เร็วพอสำหรับงานนี้ และไม่ต้องพึ่ง crypto ที่ฝั่งเบราว์เซอร์เป็น async
  let hash = 5381;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function read(): SeenEntry[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - MAX_AGE_MS;
    return parsed.filter(
      (e): e is SeenEntry =>
        Boolean(e) &&
        typeof e.fp === "string" &&
        typeof e.at === "number" &&
        e.at > cutoff,
    );
  } catch {
    return [];
  }
}

function write(entries: SeenEntry[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // localStorage เต็มหรือถูกปิด — ปล่อยผ่าน เกมยังเล่นได้แค่กันซ้ำไม่ได้
  }
}

export function loadSeen(): SeenEntry[] {
  return read();
}

/** ลายนิ้วมือทั้งหมดที่เคยเจอ — ใช้กรองคำถามที่โมเดลเพิ่งสร้างมา */
export function seenFingerprints(): Set<string> {
  return new Set(read().map((e) => e.fp));
}

/** id ที่เคยเจอ — ใช้กรองตอนสุ่มจากคลังในเครื่อง */
export function seenIds(): Set<string> {
  return new Set(read().map((e) => e.id));
}

/**
 * หัวข้อล่าสุดที่เคยถาม ส่งไปบอกโมเดลว่าอย่าถามซ้ำ
 *
 * จำกัดจำนวนไว้เพราะรายการนี้กินโทเคนใน prompt ทุกครั้งที่สร้างคำถาม
 * ส่งของใหม่สุดไปก่อนได้ผลกว่าส่งทั้งหมดแล้วโดนโมเดลอ่านข้าม
 */
export function recentTopics(limit = 40): string[] {
  return read()
    .slice(-limit)
    .map((e) => e.topic)
    .filter((t) => t.length > 0)
    .reverse();
}

export function markSeen(questions: Question[]): void {
  if (!isBrowser() || questions.length === 0) return;
  const now = Date.now();
  const existing = read();
  const known = new Set(existing.map((e) => e.fp));

  for (const q of questions) {
    const fp = fingerprint(q.prompt);
    if (known.has(fp)) continue;
    known.add(fp);
    existing.push({ fp, id: q.id, topic: q.prompt.slice(0, 80), at: now });
  }
  write(existing);
}

export function clearSeen(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(SEEN_KEY);
}

export function seenCount(): number {
  return read().length;
}
