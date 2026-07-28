// ────────────────────────────────────────────────────────────────────────────
// ผู้เข้าแข่งขัน
// ────────────────────────────────────────────────────────────────────────────

/** solo = ซ้อมคนเดียว · bot = สู้กับ AI · ffa = 2-4 คนตัวใครตัวมัน · team = 2-4 ทีม ทีมละ 2 */
export type MatchMode = "solo" | "bot" | "ffa" | "team";

export type ParticipantKind = "human" | "bot";

export interface Participant {
  id: string;
  name: string;
  kind: ParticipantKind;
  /** โหมดทีม: ชื่อสมาชิก 2 คน */
  members: string[];
  score: number;
  tokens: number;
}

export const MAX_PARTICIPANTS = 4;
export const TEAM_SIZE = 2;

// ────────────────────────────────────────────────────────────────────────────
// คำถาม
// ────────────────────────────────────────────────────────────────────────────

export type Category =
  | "สแกม"
  | "การเงิน"
  | "AI"
  | "สุขภาพ"
  | "ที่ทำงาน"
  | "ชีวิตจริง"
  | "สื่อสาร"
  | "ตรรกะ";

export type Stage = "warmup" | "push" | "final";

export type Difficulty = "ง่าย" | "กลาง" | "ยาก";

/**
 * choice      = ปรนัย เลือกตัวเลือก
 * open        = อัตนัย พิมพ์ตอบเป็นข้อความ แล้วให้ Claude ตรวจตาม rubric
 * performance = โชว์ความสามารถ (ร้องเพลง / พูดบทความ / นำเสนอ) ให้คนอื่นกดดาว
 */
export type QuestionFormat = "choice" | "open" | "performance";

export interface Question {
  id: string;
  category: Category;
  stage: Stage;
  difficulty: Difficulty;
  format: QuestionFormat;
  pointValue: number;
  prompt: string;
  /** format: choice */
  choices?: string[];
  correctAnswer?: string;
  /** format: open / performance — เกณฑ์ให้คะแนน */
  rubric?: string;
  /** format: open — ประเด็นที่คำตอบที่ดีควรมี (ใช้เป็นบริบทให้ผู้ตรวจ) */
  keyPoints?: string[];
  /** format: performance — สิ่งที่ต้องทำบนเวที */
  task?: string;
  explanation?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// กล่องคำใบ้ — 4 กล่อง มีทั้งจริงและหลอก อย่างน้อยอย่างละ 1
// ────────────────────────────────────────────────────────────────────────────

export type HintTruth = "จริง" | "หลอก";

/** สิ่งที่ client ได้รับ — ไม่มี label จริง/หลอกติดมา */
export interface HintBox {
  id: string;
  /** ป้ายกล่อง: A B C D */
  label: string;
  text: string;
}

export interface RevealedHintBox extends HintBox {
  truth: HintTruth;
  rationale: string;
}

export interface HintApiRequest {
  questionId: string;
}

export interface HintApiResponse {
  revealToken: string;
  boxes: HintBox[];
  source: "claude" | "fallback";
}

export interface RevealApiRequest {
  revealToken: string;
}

export interface RevealApiResponse {
  questionId: string;
  boxes: RevealedHintBox[];
}

// ────────────────────────────────────────────────────────────────────────────
// ตรวจคำตอบอัตนัย
// ────────────────────────────────────────────────────────────────────────────

export interface GradeApiRequest {
  questionId: string;
  answer: string;
}

export interface GradeApiResponse {
  /** 0-100 */
  score: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
  source: "claude" | "fallback";
}

// ────────────────────────────────────────────────────────────────────────────
// บันทึกระหว่างเกม
// ────────────────────────────────────────────────────────────────────────────

export interface HintUsage {
  questionId: string;
  participantId: string;
  boxLabel: string;
  boxId: string;
  text: string;
  revealToken: string;
  /** ผู้เล่นตอบถูกในข้อนั้นหรือไม่ (สำหรับสรุปผล) */
  wasCorrect: boolean;
}

export interface RoundResult {
  questionId: string;
  stage: Stage;
  format: QuestionFormat;
  prompt: string;
  participantId: string;
  /** ปรนัย = ตัวเลือกที่กด · อัตนัย = ข้อความที่พิมพ์ · โชว์ = "-" */
  answer: string | null;
  correct: boolean;
  /** 0-100 สำหรับอัตนัย/โชว์ · ปรนัยเป็น 0 หรือ 100 */
  quality: number;
  boxesOpened: number;
  tokenSpent: boolean;
  points: number;
  timedOut: boolean;
  feedback?: string;
  /** ผู้แย่งตอบ (ถ้ามี) */
  stealParticipantId?: string;
  stealPoints?: number;
}

export type Phase = "setup" | "playing" | "debrief";

export interface GameState {
  mode: MatchMode;
  /** ค่าที่ตั้งจากหลังบ้าน — ล็อกไว้ตอนเริ่มเกม เพื่อไม่ให้แก้กลางเกมแล้วคะแนนเพี้ยน */
  settings: import("./settings").GameSettings;
  participants: Participant[];
  questions: Question[];
  currentQuestionIndex: number;
  phase: Phase;
  roundLog: RoundResult[];
  hintHistory: HintUsage[];
  /** key = `${participantId}-${stage}` — เคยตอบข้อแรกของช่วงนั้นไปแล้วหรือยัง */
  stageOpened: Record<string, boolean>;
}

// ────────────────────────────────────────────────────────────────────────────
// สรุปผล
// ────────────────────────────────────────────────────────────────────────────

export interface DebriefApiRequest {
  participants: Array<{ name: string; score: number }>;
  hintHistory: HintUsage[];
}

export interface DebriefNote {
  index: number;
  questionId: string;
  boxLabel: string;
  truth: string;
  text: string;
  wasCorrect: boolean;
  note: string;
}

export interface DebriefApiResponse {
  overall: string;
  notes: DebriefNote[];
  source: "claude" | "fallback";
}
