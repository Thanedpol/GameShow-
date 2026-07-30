import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { bumpCounter } from "./roomStore";

/**
 * ด่านหน้าของ endpoint ที่ใช้เงิน
 *
 * ที่มา: endpoint ทุกเส้นที่เรียกโมเดลเปิดให้ใครก็ยิงได้ ไม่มีทั้งรหัสและตัวจำกัด
 * จำนวนครั้ง แล้วเซิร์ฟเวอร์ก็ไปเรียก AI ด้วยคีย์ของเจ้าของเว็บให้ทุกครั้ง
 * เส้นที่แพงที่สุดคือ /api/questions/images — คำขอเดียววาดได้ 10 ภาพ (~24 บาท)
 * ยิงวนได้ไม่จำกัด · ที่อยู่ของ endpoint ไม่ใช่ความลับด้วย เพราะอ่านได้จาก
 * โค้ดหน้าเว็บที่ทุกคนโหลดไปอยู่แล้ว และ repo ก็เปิดสาธารณะ
 *
 * ด่านนี้มีสองชั้น และตั้งใจให้ชั้นที่กันได้จริงคือชั้นที่ไม่ต้องตั้งค่าอะไร:
 *
 *   1. จำกัดจำนวนครั้งต่อ IP — เปิดอยู่เสมอ ไม่ต้องตั้ง env
 *      นี่คือตัวกันจริง เพราะต่อให้คนยิงรู้ทุกอย่างเกี่ยวกับระบบ
 *      ความเสียหายก็ยังถูกล็อกไว้ที่เพดานต่อนาที/ต่อวัน
 *
 *   2. กุญแจร่วมใน header — เปิดเมื่อตั้ง APP_ACCESS_TOKEN
 *      ⚠️ ไม่ใช่ความลับจริง เพราะหน้าเว็บต้องแนบไปด้วยทุกครั้ง คนที่เปิด
 *      DevTools ดูก็เห็น · มีไว้ตัดบอทสแกนกับสคริปต์ยิงมั่วซึ่งเป็นคนส่วนใหญ่
 *      ให้จบตั้งแต่ไม่ต้องเสียคำสั่ง Redis ไปนับ ไม่ได้มีไว้กันคนที่ตั้งใจเจาะ
 */

export interface GuardRule {
  /** ชื่อสำหรับแยกโควตาของแต่ละเส้น — คนละเส้นนับแยกกัน */
  name: string;
  /** ยิงได้กี่ครั้งต่อนาทีต่อ IP */
  perMinute: number;
  /** ยิงได้กี่ครั้งต่อวันต่อ IP — กันการค่อย ๆ หยอดทีละนิด */
  perDay?: number;
  /**
   * เพดานรวมทั้งเว็บต่อวัน ไม่แยกว่าใครเรียก
   *
   * จำเป็นเพราะเพดานต่อ IP อย่างเดียว "ไม่ได้จำกัดยอดบิล" จริง ๆ —
   * คนยิงเปลี่ยน IP ได้ ยิ่งใช้ proxy ยิ่งเปลี่ยนได้ไม่จำกัด
   * ตัวนี้คือเส้นที่บอกว่า "อย่างมากที่สุดวันนี้เสียได้เท่านี้"
   *
   * แลกกับข้อเสียที่ต้องยอมรับ: ถ้ามีคนตั้งใจยิงจนเต็มเพดาน คนเล่นจริงจะเล่น
   * ไม่ได้จนกว่าจะข้ามวัน — เลือกแบบนี้เพราะ "วันนี้เล่นไม่ได้" ยังดีกว่า
   * "บิลบานเป็นหมื่น" และเจ้าของขยับเพดานเองได้ทาง env
   */
  perDayTotal?: number;
}

/** ขยับเพดานรวมได้ทาง env โดยไม่ต้องแก้โค้ด */
function envCap(name: string, fallback: number): number {
  const raw = Number(process.env[`DAILY_CAP_${name.toUpperCase()}`]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/**
 * เพดานของแต่ละเส้น ตั้งจากการเล่นจริงหนึ่งเกม (20 ข้อ) แล้วเผื่อไว้หลายเท่า
 *
 * เผื่อเยอะเป็นพิเศษสำหรับเพดานต่อ IP เพราะคนที่เล่นด้วยกันในออฟฟิศหรือ
 * ห้องอบรมเดียวกันจะออกเน็ตด้วย IP สาธารณะเบอร์เดียวกันทั้งห้อง
 * ถ้าตั้งตึงไป คนที่ 10 ของงานจะเล่นไม่ได้โดยไม่มีใครเข้าใจว่าทำไม
 *
 * ยิ่งเส้นไหนแพงต่อครั้ง เพดานยิ่งต่ำ — ภาพแพงกว่าข้อความหลายสิบเท่า
 */
export const GUARD_RULES = {
  /** เกมหนึ่งเรียกครั้งเดียว แต่รีเฟรชหน้าก็เรียกใหม่ */
  questions: {
    name: "questions",
    perMinute: 6,
    perDay: 200,
    perDayTotal: envCap("questions", 400),
  },
  /** แพงที่สุด — คำขอเดียวได้ 10 ภาพ (~24 บาท) */
  images: {
    name: "images",
    perMinute: 3,
    perDay: 40,
    perDayTotal: envCap("images", 80),
  },
  /** เกมหนึ่งใช้ ~21 ครั้ง (20 ข้อ + เตรียมล่วงหน้า) แต่กระจายทั้งเกม */
  hint: { name: "hint", perMinute: 30, perDay: 1_500, perDayTotal: envCap("hint", 4_000) },
  grade: { name: "grade", perMinute: 30, perDay: 1_000, perDayTotal: envCap("grade", 3_000) },
  /** รับไฟล์เสียงได้ถึง 8MB ต่อครั้ง */
  voice: { name: "voice", perMinute: 12, perDay: 300, perDayTotal: envCap("voice", 600) },
  debrief: { name: "debrief", perMinute: 6, perDay: 100, perDayTotal: envCap("debrief", 200) },
  /** หลังบ้านมีปุ่มที่ยิงโมเดลจริง (ทดสอบการเชื่อมต่อ / ลองสร้างคำถาม) */
  admin: { name: "admin", perMinute: 20, perDay: 300 },
} as const satisfies Record<string, GuardRule>;

const noStore = { headers: { "Cache-Control": "no-store" } };

/**
 * หา IP ของคนเรียกจาก header ที่ Vercel ใส่ให้
 *
 * x-forwarded-for เป็นรายการต่อกันด้วยคอมมา ตัวแรกคือ client จริง
 * ที่เหลือคือ proxy ที่ผ่านมา · ปลอมได้ถ้าเรียกตรงเข้าเซิร์ฟเวอร์
 * แต่บน Vercel คำขอต้องผ่าน edge เสมอ ซึ่งเขียนทับ header นี้ให้
 */
function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 60);
  }
  return request.headers.get("x-real-ip")?.slice(0, 60) ?? "unknown";
}

/** ตั้ง APP_ACCESS_TOKEN ไว้ไหม — หน้าหลังบ้านเอาไปโชว์ว่าด่านนี้เปิดอยู่หรือยัง */
export function accessTokenRequired(): boolean {
  return Boolean(process.env.APP_ACCESS_TOKEN?.trim());
}

/**
 * ตรวจก่อนทำงานให้ — คืน null แปลว่าผ่าน ให้ทำงานต่อได้
 * คืน NextResponse แปลว่าไม่ผ่าน ให้ route ส่งอันนั้นกลับไปทันที
 */
export async function guardApi(
  request: NextRequest,
  rule: GuardRule,
): Promise<NextResponse | null> {
  const expected = process.env.APP_ACCESS_TOKEN?.trim();
  if (expected) {
    const supplied = request.headers.get("x-app-key");
    if (supplied !== expected) {
      /**
       * กับดักตอน deploy: NEXT_PUBLIC_* ถูกฝังลงไฟล์ JS ตอน "build"
       * ไม่ใช่ตอนรัน ถ้าตั้ง APP_ACCESS_TOKEN ไว้แล้วแต่ลืมตั้งตัว NEXT_PUBLIC_
       * (หรือตั้งแล้วแต่ยังไม่ได้ deploy ใหม่) หน้าเว็บจะไม่มีกุญแจติดไปเลย
       * แล้วเกมจะพังทั้งระบบโดยที่ดูเหมือนตั้งค่าถูกทุกอย่าง
       *
       * แยกข้อความสองแบบเพื่อให้อ่าน log แล้วรู้ทันทีว่าเป็นกรณีไหน
       */
      if (!supplied) {
        console.warn(
          "[guard] คำขอไม่มี x-app-key — ถ้าเกมเล่นไม่ได้ทั้งระบบ " +
            "ให้เช็กว่าตั้ง NEXT_PUBLIC_APP_ACCESS_TOKEN ให้ตรงกับ APP_ACCESS_TOKEN แล้ว deploy ใหม่",
        );
      }
      return NextResponse.json(
        { error: "คำขอนี้ไม่ได้มาจากหน้าเว็บของเกม" },
        { status: 401, ...noStore },
      );
    }
  }

  const ip = clientIp(request);
  try {
    const perMinute = await bumpCounter(`${rule.name}:m:${ip}`, 60);
    if (perMinute > rule.perMinute) return tooMany(60);

    if (rule.perDay) {
      const perDay = await bumpCounter(`${rule.name}:d:${ip}`, 24 * 60 * 60);
      if (perDay > rule.perDay) return tooMany(60 * 60);
    }

    if (rule.perDayTotal) {
      // ผูกกับวันที่ ไม่ใช่ TTL ลอย ๆ เพื่อให้โควตารีเซ็ตพร้อมกันทั้งเว็บ
      // ไม่ใช่ทยอยหมดอายุคนละเวลาจนคำนวณยอดสูงสุดต่อวันไม่ได้
      const today = new Date().toISOString().slice(0, 10);
      const total = await bumpCounter(`${rule.name}:all:${today}`, 26 * 60 * 60);
      if (total > rule.perDayTotal) {
        console.warn(`[guard] ${rule.name} ชนเพดานรวมของวันนี้แล้ว (${rule.perDayTotal})`);
        return tooMany(60 * 60);
      }
    }
  } catch (error) {
    /**
     * นับไม่ได้ก็ปล่อยผ่าน ไม่ใช่ปิดประตู
     *
     * ตัวนับอยู่บน Redis ซึ่งล่มได้ ถ้าเลือกปิดประตูตอนนับไม่ได้ เกมจะเล่นไม่ได้
     * ทั้งระบบเพราะที่เก็บสถิติล่ม ซึ่งเป็นความเสียหายที่แน่นอนกว่าความเสี่ยง
     * ที่จะโดนยิงพอดีในนาทีเดียวกัน
     */
    console.warn(`[guard] นับ rate limit ไม่ได้ ปล่อยผ่านไปก่อน:`, error);
  }
  return null;
}

function tooMany(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "เรียกถี่เกินไป กรุณารอสักครู่แล้วลองใหม่" },
    {
      status: 429,
      headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfterSeconds) },
    },
  );
}
