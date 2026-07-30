import { llmRequestPayload } from "./settings";
import type { HintApiResponse, Question } from "./types";
import { apiHeaders } from "./apiHeaders";

/**
 * เตรียมกล่องคำใบ้ล่วงหน้า
 *
 * ของเดิมยิง /api/hint ตอน "คำถามขึ้นจอ" พอดี ซึ่งแปลว่าผู้เล่นต้องเห็นคำว่า
 * "กำลังเตรียม" บนกล่องทั้งสี่ทุกข้อแน่นอน วัดจริงแล้วสร้างกล่องใช้เวลา ~8 วินาที
 * และนาฬิกาก็เดินไปแล้วด้วย — เท่ากับกินเวลาคิดของผู้เล่นฟรี ๆ ทุกข้อ
 *
 * ย้ายมาเตรียมของข้อถัดไปตั้งแต่ข้อปัจจุบันเริ่ม ระหว่างนั้นผู้เล่นกำลังอ่านโจทย์
 * และคิดคำตอบอยู่ 60 วินาที เหลือเฟือสำหรับ 8 วินาที พอถึงข้อถัดไปกล่องก็พร้อมทันที
 *
 * เก็บเป็น promise ไม่ใช่ผลลัพธ์ เพื่อให้ข้อที่มาถึงก่อนของจะเสร็จ ไปเกาะรอ
 * อันเดิมได้เลย ไม่ยิงซ้ำเป็นครั้งที่สอง
 */

/** เก็บพอให้ครอบคลุมข้อปัจจุบันกับข้อถัดไป ที่เหลือทิ้งได้ ไม่ให้บวมข้ามเกม */
const MAX_CACHED = 4;

const cache = new Map<string, Promise<HintApiResponse | null>>();
/** id ที่ยิงเสร็จแล้ว (สำเร็จหรือล้มก็นับ) — ใช้บอกว่าเตรียมของข้อนั้นจบหรือยัง */
const settled = new Set<string>();

/**
 * ไม่ throw ออกไปเลย — คืน null แทน
 *
 * เพราะ promise ถูกเก็บไว้ก่อนที่จะมีใครมา await ถ้าปล่อยให้ reject
 * เบราว์เซอร์จะขึ้น unhandled rejection ทั้งที่เราจัดการเองอยู่แล้ว
 */
async function fetchHints(question: Question): Promise<HintApiResponse | null> {
  try {
    const res = await fetch("/api/hint", {
      method: "POST",
      headers: apiHeaders(),
      // ส่งตัวข้อไปด้วย เผื่อเป็นคำถามที่แก้/เพิ่มจากหลังบ้าน
      // ซึ่งเซิร์ฟเวอร์ไม่มีอยู่ในคลังตั้งต้น
      body: JSON.stringify({
        questionId: question.id,
        question,
        llm: llmRequestPayload("hint"),
      }),
    });
    if (!res.ok) return null;
    return (await res.json()) as HintApiResponse;
  } catch {
    return null;
  }
}

/** สั่งเตรียมไว้เฉย ๆ ไม่ต้องรอผล — เรียกซ้ำได้ปลอดภัย */
export function warmHints(question: Question | null | undefined): void {
  if (!question || cache.has(question.id)) return;
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  const id = question.id;
  cache.set(
    id,
    // นับว่า "เตรียมจบ" ทั้งตอนสำเร็จและตอนล้ม ไม่งั้นถ้ายิงไม่ผ่านสักครั้ง
    // หน้าตั้งค่าจะขึ้นว่ากำลังเตรียมค้างไว้ตลอดกาล
    fetchHints(question).then((data) => {
      settled.add(id);
      return data;
    }),
  );
}

/** เตรียมของข้อนี้จบหรือยัง — ข้อที่ไม่มีอยู่ถือว่าไม่ต้องรอ */
export function hintsReady(question: Question | null | undefined): boolean {
  return question ? settled.has(question.id) : true;
}

/** เอาไปใช้จริง — ถ้าเตรียมไว้แล้วจะได้ทันที ถ้ายังไม่ได้เตรียมจะเริ่มให้ */
export function takeHints(question: Question): Promise<HintApiResponse | null> {
  warmHints(question);
  return cache.get(question.id) ?? fetchHints(question);
}

/** ล้างทิ้งตอนเริ่มเกมใหม่ กันของข้ามเกมค้าง */
export function resetHints(): void {
  cache.clear();
  settled.clear();
}
