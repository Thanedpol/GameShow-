import type { HintType, PlayerId, Stage } from "./types";

export const MAX_TOKENS = 3;
export const ANSWER_SECONDS = 20;
export const STEAL_SECONDS = 10;
export const FINAL_SECONDS = 15;
/** เวลาขั้นต่ำที่ผู้เล่นจะได้หลังจากคำใบ้โผล่ขึ้นมา (กันเวลาหมดเพราะรอ API) */
export const MIN_SECONDS_AFTER_HINT = 12;

export interface AnswerScoreInput {
  pointValue: number;
  /** null = ไม่ได้ขอ AI ช่วย */
  hintType: HintType | null;
  /** ใช้โทเคนคำใบ้เพื่อยกเว้นการหัก 50% ของ "ใบ้ตรง" */
  tokenSpent: boolean;
  correct: boolean;
}

/**
 * กติกาคะแนน (ตามหัวข้อ R ของโจทย์)
 *  - ไม่ขอใบ้ + ถูก        → +pointValue
 *  - ไม่ขอใบ้ + ผิด        → 0 (แล้วเปิดสิทธิ์แย่งตอบ)
 *  - "ใบ้ตรง" + ถูก        → +pointValue × 50%  (ถ้าจ่ายโทเคน → เต็ม 100%)
 *  - "ใบ้ตรง" + ผิด        → 0 (แล้วเปิดสิทธิ์แย่งตอบ)
 *  - "ใบ้ลวง" + ถูก        → +pointValue × 2
 *  - "ใบ้ลวง" + ผิด        → −pointValue × 2 (แล้วเปิดสิทธิ์แย่งตอบ)
 *
 * หมายเหตุ: หมดเวลา = ตอบผิด (ใช้กติกาเดียวกันทุกประการ)
 */
export function scoreForAnswer({
  pointValue,
  hintType,
  tokenSpent,
  correct,
}: AnswerScoreInput): number {
  if (hintType === "ลวง") {
    return correct ? pointValue * 2 : -pointValue * 2;
  }
  if (hintType === "ตรง") {
    if (!correct) return 0;
    return tokenSpent ? pointValue : Math.round(pointValue * 0.5);
  }
  return correct ? pointValue : 0;
}

/** แย่งตอบถูก = ได้คะแนนเต็มของข้อนั้น, ผิด/หมดเวลา = 0 (ไม่ติดลบ) */
export function scoreForSteal(pointValue: number, correct: boolean): number {
  return correct ? pointValue : 0;
}

/** AI Duel Final — คะแนน x2 ของข้อนั้น, ตอบผิดไม่ติดลบ */
export function scoreForFinal(pointValue: number, correct: boolean): number {
  return correct ? pointValue * 2 : 0;
}

/** สลับผู้เล่นที่เป็นเจ้าของสิทธิ์ตอบ: ข้อคี่ = ผู้เล่น 1, ข้อคู่ = ผู้เล่น 2 */
export function activePlayerFor(questionIndex: number): PlayerId {
  return questionIndex % 2 === 0 ? 1 : 2;
}

export function opponentOf(player: PlayerId): PlayerId {
  return player === 1 ? 2 : 1;
}

export function stageKey(player: PlayerId, stage: Stage): string {
  return `${player}-${stage}`;
}

export const STAGE_LABEL: Record<Stage, string> = {
  warmup: "Warm-Up",
  push: "Push Your Luck",
  final: "AI Duel Final",
};
