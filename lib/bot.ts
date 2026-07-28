import type { Difficulty, Question } from "./types";

/**
 * บอทแบบ heuristic — จงใจไม่เรียก Claude
 *
 * เหตุผล: กติกาบังคับว่าทุกอย่างต้องจบใน 60 วินาที การให้บอทรอ LLM ตอบ
 * จะกินเวลาจริงและทำให้จังหวะเกมสะดุด อีกทั้งเปลืองโทเคนโดยไม่จำเป็น
 * บอทจึงตัดสินใจจากความน่าจะเป็นตามระดับความยากแทน
 */

export type BotLevel = "ง่าย" | "ปกติ" | "โหด";

export const BOT_LEVELS: BotLevel[] = ["ง่าย", "ปกติ", "โหด"];

/** โอกาสตอบถูกของบอท แยกตามระดับบอท × ความยากของข้อ */
const ACCURACY: Record<BotLevel, Record<Difficulty, number>> = {
  ง่าย: { ง่าย: 0.6, กลาง: 0.4, ยาก: 0.25 },
  ปกติ: { ง่าย: 0.85, กลาง: 0.65, ยาก: 0.45 },
  โหด: { ง่าย: 0.95, กลาง: 0.85, ยาก: 0.7 },
};

/** คุณภาพคำตอบอัตนัย/โชว์ของบอท (เป็นช่วง แล้วสุ่มภายในช่วง) */
const QUALITY_BAND: Record<BotLevel, [number, number]> = {
  ง่าย: [25, 55],
  ปกติ: [45, 78],
  โหด: [65, 92],
};

/** โอกาสที่บอทจะเปิดกล่องคำใบ้ (ยิ่งข้อยาก ยิ่งเปิด) */
const BOX_APPETITE: Record<Difficulty, number> = {
  ง่าย: 0.15,
  กลาง: 0.35,
  ยาก: 0.55,
};

export interface BotTurn {
  /** จำนวนกล่องที่บอทเปิด (0-2) */
  boxesOpened: number;
  /** ปรนัย: ตัวเลือกที่บอทกด · อื่น ๆ: null */
  choice: string | null;
  correct: boolean;
  /** 0-100 */
  quality: number;
  /** วินาทีที่บอทใช้ก่อนตอบ (ใช้หน่วงให้ดูสมจริง) */
  thinkSeconds: number;
}

function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function planBotTurn(question: Question, level: BotLevel): BotTurn {
  const appetite = BOX_APPETITE[question.difficulty];
  let boxesOpened = 0;
  if (Math.random() < appetite) boxesOpened = 1;
  if (boxesOpened === 1 && Math.random() < appetite * 0.4) boxesOpened = 2;

  const baseAccuracy = ACCURACY[level][question.difficulty];
  // เปิดกล่องแล้วอาจเจอใบ้หลอก — บอทก็โดนหลอกได้เหมือนกัน
  const foolPenalty = boxesOpened > 0 && Math.random() < 0.35 ? 0.25 : 0;
  const accuracy = Math.max(0.05, baseAccuracy - foolPenalty);

  const thinkSeconds = Math.round(randBetween(6, 26));

  if (question.format === "choice" && question.choices?.length) {
    const correct = Math.random() < accuracy;
    const wrong = question.choices.filter((c) => c !== question.correctAnswer);
    const choice = correct
      ? (question.correctAnswer ?? question.choices[0])
      : (wrong[Math.floor(Math.random() * wrong.length)] ?? question.choices[0]);
    return { boxesOpened, choice, correct, quality: correct ? 100 : 0, thinkSeconds };
  }

  // อัตนัย / โชว์ความสามารถ — ให้คะแนนในช่วงตามระดับบอท
  const [lo, hi] = QUALITY_BAND[level];
  const quality = Math.round(randBetween(lo, hi) * (1 - foolPenalty));
  return {
    boxesOpened,
    choice: null,
    correct: quality >= 60,
    quality,
    thinkSeconds,
  };
}

/** ข้อความสั้น ๆ ที่บอทพูดตอนเฉลย เพื่อให้เกมมีชีวิต */
export function botRemark(turn: BotTurn, level: BotLevel): string {
  if (turn.boxesOpened > 0 && !turn.correct) {
    return `เปิดไป ${turn.boxesOpened} กล่องแล้วดันเชื่อผิดกล่องซะงั้น`;
  }
  if (turn.correct && turn.boxesOpened === 0) {
    return "ข้อนี้ไม่ต้องพึ่งกล่องเลย";
  }
  if (turn.correct) {
    return `เปิด ${turn.boxesOpened} กล่องแล้วเลือกเชื่อถูกกล่อง`;
  }
  return level === "โหด" ? "พลาดไปนิดเดียว" : "ข้อนี้ยากไปหน่อย";
}
