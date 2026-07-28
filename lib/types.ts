// ────────────────────────────────────────────────────────────────────────────
// Core domain types — ตรงตามสเปกในโจทย์ (มีการเพิ่มฟิลด์ที่จำเป็นบางตัว ดู README)
// ────────────────────────────────────────────────────────────────────────────

export type Category =
  | "สแกม"
  | "การเงิน"
  | "AI"
  | "สุขภาพ"
  | "ประวัติศาสตร์"
  | "ตรรกะ";

export type Stage = "warmup" | "push" | "final";

/** โหมดคำใบ้ที่ผู้เล่นเลือกได้ระหว่างเกม */
export type HintType = "ตรง" | "ลวง";

/** โหมดที่ส่งไปยัง /api/hint (รวมโหมด final ที่สร้าง 3 ชุดพร้อมกัน) */
export type HintMode = HintType | "final";

export type PlayerId = 1 | 2;

export interface Question {
  id: string;
  category: Category;
  stage: Stage;
  pointValue: number;
  /** ตัวคำถาม — เพิ่มจากสเปก เพราะจำเป็นต่อการแสดงผล */
  prompt: string;
  correctAnswer: string;
  choices: string[];
  /** คำอธิบายเฉลยแบบสั้น ใช้ตอนสรุปผล */
  explanation?: string;
}

export interface HintRequest {
  questionId: string;
  player: PlayerId;
  hintType: HintType;
  aiGeneratedText: string;
  wasCorrect: boolean;
  /** อ้างอิงไปยัง label ฝั่งเซิร์ฟเวอร์ (ไม่มีข้อมูลจริง/หลอกอยู่ในนี้) */
  revealId?: string;
  hintId?: string;
  /**
   * true = คำใบ้จากรอบ AI Duel Final ซึ่งผู้เล่นไม่ได้เลือกโหมดเอง
   * (ระบบแจกครบชุดจริง 1 หลอก 2) — ใช้แยกการแสดงผลตอน Debrief
   */
  fromFinalDuel?: boolean;
}

export interface GameState {
  player1Name: string;
  player2Name: string;
  currentQuestionIndex: number;
  player1Score: number;
  player2Score: number;
  player1Tokens: number;
  player2Tokens: number;
  hintHistory: HintRequest[];
}

// ────────────────────────────────────────────────────────────────────────────
// Runtime / session state (ห่อ GameState ไว้ข้างใน)
// ────────────────────────────────────────────────────────────────────────────

export type Phase = "setup" | "playing" | "final" | "debrief";

export interface RoundResult {
  questionId: string;
  stage: Stage;
  prompt: string;
  correctAnswer: string;
  answeringPlayer: PlayerId;
  answeredChoice: string | null;
  wasCorrect: boolean;
  hintType: HintType | null;
  tokenSpent: boolean;
  pointsDelta: number;
  /** กรณีอีกฝ่ายแย่งตอบ */
  stealPlayer?: PlayerId;
  stealChoice?: string | null;
  stealCorrect?: boolean;
  stealPoints?: number;
  timedOut?: boolean;
}

export interface FinalResult {
  questionId: string;
  prompt: string;
  correctAnswer: string;
  player1Choice: string | null;
  player2Choice: string | null;
  player1Correct: boolean;
  player2Correct: boolean;
  player1Points: number;
  player2Points: number;
  revealId: string | null;
}

export interface SessionState extends GameState {
  phase: Phase;
  /** ชุดคำถามที่สุ่มมาใช้ในเกมนี้ (warmup 4 + push 4 + final 1) */
  questions: Question[];
  finalQuestion: Question | null;
  roundLog: RoundResult[];
  finalResult: FinalResult | null;
  /** ผู้เล่นคนไหนได้ "ตอบข้อแรกของช่วง" ไปแล้วบ้าง key = `${player}-${stage}` */
  stageOpened: Record<string, boolean>;
}

// ────────────────────────────────────────────────────────────────────────────
// API contracts
// ────────────────────────────────────────────────────────────────────────────

/** คำใบ้ที่ส่งให้ frontend — ไม่มี label จริง/หลอกติดไปด้วยโดยเจตนา */
export interface PublicHint {
  id: string;
  text: string;
}

export interface HintApiRequest {
  questionId: string;
  correctAnswer: string;
  hintType: HintMode;
}

export interface HintApiResponse {
  revealId: string;
  hints: PublicHint[];
  /** "claude" = มาจาก API จริง, "fallback" = โหมดสำรองตอนไม่มี API key */
  source: "claude" | "fallback";
}

/** ผลเฉลย label — เรียกได้หลังจบข้อ/ตอนสรุปเท่านั้น */
export interface RevealedHint extends PublicHint {
  truth: "จริง" | "หลอก";
  mode: HintType;
  rationale: string;
}

export interface RevealApiResponse {
  revealId: string;
  questionId: string;
  hints: RevealedHint[];
}

export interface DebriefApiRequest {
  player1Name: string;
  player2Name: string;
  player1Score: number;
  player2Score: number;
  hintHistory: HintRequest[];
}

export interface DebriefNote {
  /** index ตรงกับตำแหน่งใน hintHistory ที่ส่งไป */
  index: number;
  questionId: string;
  hintType: string;
  truth: string;
  hintText: string;
  wasCorrect: boolean;
  /** คำอธิบายว่าทำไมคำใบ้นี้ถูกออกแบบแบบนี้ */
  text: string;
}

export interface DebriefApiResponse {
  overall: string;
  notes: DebriefNote[];
  source: "claude" | "fallback";
}
