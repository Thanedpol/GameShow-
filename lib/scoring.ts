import type { MatchMode, Participant, Stage } from "./types";

/**
 * ค่าตั้งต้นของกลไกคำใบ้
 * เวลาต่อข้อและโควตาการเปิดกล่องแยกตามช่วง — ดู DEFAULT_SETTINGS ใน lib/settings.ts
 */
export const HINT_BOX_COUNT = 4;

/** เปิด 1 กล่อง หักคะแนนข้อนั้น 25% */
export const BOX_COST_RATIO = 0.25;

export const STAGE_LABEL: Record<Stage, string> = {
  warmup: "Warm-Up",
  push: "Push Your Luck",
  final: "AI Duel Final",
};

export const MODE_LABEL: Record<MatchMode, string> = {
  solo: "ซ้อมคนเดียว",
  bot: "ดวลกับบอท AI",
  ffa: "ตัวใครตัวมัน",
  team: "แข่งเป็นทีม",
};

/**
 * ตัวคูณคะแนนที่เหลือหลังเปิดกล่องคำใบ้
 * paidBoxes = จำนวนกล่องที่เปิดโดยไม่ได้ใช้โทเคน
 * costRatio  = ค่าหักต่อกล่อง (ปรับได้จากหลังบ้าน)
 */
export function hintMultiplier(paidBoxes: number, costRatio = BOX_COST_RATIO): number {
  return Math.max(0, 1 - costRatio * paidBoxes);
}

export interface ScoreInput {
  pointValue: number;
  /** 0-100 — ปรนัยคือ 0 หรือ 100 · อัตนัย/โชว์คือคะแนนจากผู้ตรวจ */
  quality: number;
  /** กล่องที่เปิดและต้องจ่ายคะแนน (ไม่นับกล่องที่ใช้โทเคนแลก) */
  paidBoxes: number;
  timedOut: boolean;
  /** ค่าหักต่อกล่อง (ปรับได้จากหลังบ้าน) */
  costRatio?: number;
}

/** ไม่ตอบ/หมดเวลา = 0 คะแนนเสมอ และไม่มีคะแนนติดลบในเกมนี้ */
export function scoreForRound({
  pointValue,
  quality,
  paidBoxes,
  timedOut,
  costRatio,
}: ScoreInput): number {
  if (timedOut || quality <= 0) return 0;
  const raw = pointValue * hintMultiplier(paidBoxes, costRatio) * (quality / 100);
  return Math.max(0, Math.round(raw));
}

/** แย่งตอบถูก = ได้คะแนนเต็มของข้อนั้น (ผู้แย่งไม่ได้เปิดกล่อง) */
export function scoreForSteal(pointValue: number, correct: boolean): number {
  return correct ? pointValue : 0;
}

export function stageKey(participantId: string, stage: Stage): string {
  return `${participantId}-${stage}`;
}

/** ผลัดกันตอบวนไปตามลำดับผู้เข้าแข่งขัน */
export function activeParticipantIndex(questionIndex: number, count: number): number {
  return count > 0 ? questionIndex % count : 0;
}

export function participantById(
  participants: Participant[],
  id: string,
): Participant | undefined {
  return participants.find((p) => p.id === id);
}

export function nameOfId(participants: Participant[], id: string): string {
  return participantById(participants, id)?.name ?? "—";
}

export function rankParticipants(participants: Participant[]): Participant[] {
  return [...participants].sort((a, b) => b.score - a.score);
}

/** คืนผู้ชนะ (อาจเสมอกันหลายคน) */
export function winnersOf(participants: Participant[]): Participant[] {
  if (participants.length === 0) return [];
  const top = Math.max(...participants.map((p) => p.score));
  return participants.filter((p) => p.score === top);
}
