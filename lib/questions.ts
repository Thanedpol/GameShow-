import type { Question, Stage } from "./types";

export const POINTS: Record<Stage, number> = {
  warmup: 100,
  push: 200,
  final: 300,
};

/**
 * คลังคำถามตั้งต้น 12 ข้อ — 2 ข้อต่อหมวด ใน 6 หมวด
 * ทุกข้อมีคำตอบเดียวที่ตรวจสอบได้จริง (ไม่ใช่คำถามความเห็น)
 *
 * การกระจายช่วง: warmup 5 / push 5 / final 2
 * แต่ละเกมจะสุ่มมาใช้ warmup 4 + push 4 + final 1 = 9 ข้อ
 */
export const QUESTION_BANK: Question[] = [
  // ── สแกม ──────────────────────────────────────────────────────────────
  {
    id: "scam-01",
    category: "สแกม",
    stage: "warmup",
    pointValue: POINTS.warmup,
    prompt:
      "การหลอกลวงที่ส่งอีเมลหรือ SMS ปลอมให้เหยื่อกรอกรหัสผ่านลงในหน้าเว็บเลียนแบบ เรียกว่าอะไร",
    correctAnswer: "ฟิชชิง (Phishing)",
    choices: [
      "ฟิชชิง (Phishing)",
      "แรนซัมแวร์ (Ransomware)",
      "ดีดอส (DDoS)",
      "บรูตฟอร์ซ (Brute Force)",
    ],
    explanation:
      "Phishing คือการปลอมตัวเป็นองค์กรที่น่าเชื่อถือเพื่อ 'ตกเบ็ด' ข้อมูลประจำตัวของเหยื่อ",
  },
  {
    id: "scam-02",
    category: "สแกม",
    stage: "push",
    pointValue: POINTS.push,
    prompt: "รหัส OTP ที่ธนาคารส่งมายืนยันตัวตน ย่อมาจากคำว่าอะไร",
    correctAnswer: "One-Time Password",
    choices: [
      "One-Time Password",
      "Online Transaction Protocol",
      "Official Token Pass",
      "Open Trusted Payment",
    ],
    explanation: "OTP = One-Time Password รหัสผ่านที่ใช้ได้ครั้งเดียวและหมดอายุเร็ว",
  },

  // ── การเงิน ───────────────────────────────────────────────────────────
  {
    id: "fin-01",
    category: "การเงิน",
    stage: "warmup",
    pointValue: POINTS.warmup,
    prompt: "กฎ 72 (Rule of 72) ในโลกการเงิน ใช้ประมาณค่าอะไร",
    correctAnswer: "ระยะเวลาที่เงินลงทุนจะโตเป็นสองเท่า",
    choices: [
      "ระยะเวลาที่เงินลงทุนจะโตเป็นสองเท่า",
      "อัตราภาษีสูงสุดที่ต้องจ่าย",
      "สัดส่วนหนี้สินต่อรายได้ที่ปลอดภัย",
      "จำนวนปีที่ควรถือหุ้นก่อนขาย",
    ],
    explanation: "หาร 72 ด้วยอัตราผลตอบแทนต่อปี จะได้จำนวนปีที่เงินต้นโตเป็นสองเท่าโดยประมาณ",
  },
  {
    id: "fin-02",
    category: "การเงิน",
    stage: "push",
    pointValue: POINTS.push,
    prompt:
      "ฝากเงินที่ได้ผลตอบแทนทบต้น 6% ต่อปี ตามกฎ 72 เงินจะโตเป็นสองเท่าในเวลาประมาณกี่ปี",
    correctAnswer: "ประมาณ 12 ปี",
    choices: ["ประมาณ 12 ปี", "ประมาณ 6 ปี", "ประมาณ 18 ปี", "ประมาณ 24 ปี"],
    explanation: "72 ÷ 6 = 12 ปี",
  },

  // ── AI ────────────────────────────────────────────────────────────────
  {
    id: "ai-01",
    category: "AI",
    stage: "warmup",
    pointValue: POINTS.warmup,
    prompt: "ตัวอักษร L ตัวแรกในคำว่า LLM ย่อมาจากคำว่าอะไร",
    correctAnswer: "Large",
    choices: ["Large", "Logical", "Linear", "Layered"],
    explanation: "LLM = Large Language Model",
  },
  {
    id: "ai-02",
    category: "AI",
    stage: "final",
    pointValue: POINTS.final,
    prompt:
      "สถาปัตยกรรมโครงข่ายประสาทเทียมที่เป็นรากฐานของโมเดลภาษาขนาดใหญ่ยุคปัจจุบัน ถูกนำเสนอในงานวิจัยปี 2017 ชื่อสถาปัตยกรรมนี้คืออะไร",
    correctAnswer: "Transformer",
    choices: ["Transformer", "LSTM", "Perceptron", "Convolutional Neural Network"],
    explanation:
      "งานวิจัย \"Attention Is All You Need\" (2017) เสนอสถาปัตยกรรม Transformer",
  },

  // ── สุขภาพ ────────────────────────────────────────────────────────────
  {
    id: "hea-01",
    category: "สุขภาพ",
    stage: "warmup",
    pointValue: POINTS.warmup,
    prompt: "อวัยวะใดในร่างกายมนุษย์ทำหน้าที่ 'ผลิต' น้ำดี (bile)",
    correctAnswer: "ตับ",
    choices: ["ตับ", "ถุงน้ำดี", "ตับอ่อน", "ม้าม"],
    explanation: "ตับเป็นผู้ผลิตน้ำดี ส่วนถุงน้ำดีทำหน้าที่เก็บสะสมไว้เท่านั้น",
  },
  {
    id: "hea-02",
    category: "สุขภาพ",
    stage: "push",
    pointValue: POINTS.push,
    prompt: "โครงกระดูกของผู้ใหญ่ทั่วไปประกอบด้วยกระดูกกี่ชิ้น",
    correctAnswer: "206 ชิ้น",
    choices: ["206 ชิ้น", "180 ชิ้น", "270 ชิ้น", "312 ชิ้น"],
    explanation: "ทารกแรกเกิดมีราว 270 ชิ้น แล้วเชื่อมรวมกันเหลือ 206 ชิ้นเมื่อโตเต็มวัย",
  },

  // ── ประวัติศาสตร์ ─────────────────────────────────────────────────────
  {
    id: "his-01",
    category: "ประวัติศาสตร์",
    stage: "warmup",
    pointValue: POINTS.warmup,
    prompt: "กำแพงเบอร์ลินถูกทลายลงในปี ค.ศ. ใด",
    correctAnswer: "ค.ศ. 1989",
    choices: ["ค.ศ. 1989", "ค.ศ. 1961", "ค.ศ. 1991", "ค.ศ. 1975"],
    explanation: "คืนวันที่ 9 พฤศจิกายน ค.ศ. 1989 (กำแพงเริ่มสร้างปี 1961)",
  },
  {
    id: "his-02",
    category: "ประวัติศาสตร์",
    stage: "push",
    pointValue: POINTS.push,
    prompt: "มนุษย์คนแรกที่เหยียบพื้นผิวดวงจันทร์คือใคร",
    correctAnswer: "นีล อาร์มสตรอง",
    choices: ["นีล อาร์มสตรอง", "บัซซ์ อัลดริน", "ยูริ กาการิน", "ไมเคิล คอลลินส์"],
    explanation:
      "ภารกิจ Apollo 11 ปี 1969 — อาร์มสตรองลงก่อน อัลดรินตามมาเป็นคนที่สอง",
  },

  // ── ตรรกะ ─────────────────────────────────────────────────────────────
  {
    id: "log-01",
    category: "ตรรกะ",
    stage: "push",
    pointValue: POINTS.push,
    prompt:
      "กำหนดให้ (1) นกทุกตัวบินได้ (2) ทวีตตี้เป็นนก ข้อสรุปใดถูกต้องตามหลักตรรกะนิรนัย",
    correctAnswer: "ทวีตตี้บินได้",
    choices: [
      "ทวีตตี้บินได้",
      "ทุกสิ่งที่บินได้เป็นนก",
      "ทวีตตี้อาจบินไม่ได้",
      "สรุปไม่ได้จากข้อมูลที่ให้",
    ],
    explanation:
      "เป็นซิลโลจิซึมมาตรฐาน: ถ้าสมาชิกทุกตัวของ A มีสมบัติ P และ x เป็นสมาชิกของ A แล้ว x มีสมบัติ P",
  },
  {
    id: "log-02",
    category: "ตรรกะ",
    stage: "final",
    pointValue: POINTS.final,
    prompt: "ลำดับ 2, 6, 12, 20, 30, ... จำนวนถัดไปคือเลขอะไร",
    correctAnswer: "42",
    choices: ["42", "40", "36", "45"],
    explanation:
      "พจน์ที่ n คือ n×(n+1) → 1×2=2, 2×3=6, 3×4=12, 4×5=20, 5×6=30, 6×7=42 (ผลต่างเพิ่มทีละ 2)",
  },
];

export function getQuestionById(id: string): Question | undefined {
  return QUESTION_BANK.find((q) => q.id === id);
}

function shuffle<T>(input: readonly T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export interface DrawnQuestions {
  /** 8 ข้อ: warmup 4 ข้อ ตามด้วย push 4 ข้อ */
  main: Question[];
  /** ข้อสุดท้ายสำหรับ AI Duel Final */
  final: Question;
}

/** สุ่มชุดคำถามสำหรับ 1 เกม พร้อมสลับลำดับตัวเลือกในแต่ละข้อ */
export function drawQuestions(): DrawnQuestions {
  const warmup = shuffle(QUESTION_BANK.filter((q) => q.stage === "warmup")).slice(0, 4);
  const push = shuffle(QUESTION_BANK.filter((q) => q.stage === "push")).slice(0, 4);
  const final = shuffle(QUESTION_BANK.filter((q) => q.stage === "final"))[0];

  const withShuffledChoices = (q: Question): Question => ({
    ...q,
    choices: shuffle(q.choices),
  });

  return {
    main: [...warmup, ...push].map(withShuffledChoices),
    final: withShuffledChoices(final),
  };
}
