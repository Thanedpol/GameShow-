import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { HINT_BOX_COUNT } from "./scoring";
import type { HintTruth, Question, RevealedHintBox } from "./types";

export const HINT_MODEL = process.env.HINT_MODEL?.trim() || "claude-opus-5";

let cachedClient: Anthropic | null = null;

export function getAnthropic(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  if (!cachedClient) cachedClient = new Anthropic({ apiKey, maxRetries: 1 });
  return cachedClient;
}

// ────────────────────────────────────────────────────────────────────────────
// Reveal token — เก็บ label "จริง/หลอก" แบบ stateless (ใช้ได้บน serverless)
// ────────────────────────────────────────────────────────────────────────────

export interface RevealPayload {
  questionId: string;
  createdAt: number;
  boxes: RevealedHintBox[];
}

const REVEAL_TTL_MS = 60 * 60 * 1000;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DEV_KEY_MATERIAL = "baijing-bailok-dev-only-key-material";

let cachedKey: Buffer | null = null;
let warnedAboutDevKey = false;

function getRevealKey(): Buffer {
  if (cachedKey) return cachedKey;
  const explicit = process.env.REVEAL_SECRET?.trim();
  const fallback = process.env.ANTHROPIC_API_KEY?.trim();
  const material = explicit || fallback || DEV_KEY_MATERIAL;

  if (!explicit && !fallback && !warnedAboutDevKey) {
    warnedAboutDevKey = true;
    console.warn("[reveal] ไม่พบ REVEAL_SECRET/ANTHROPIC_API_KEY — ใช้คีย์ dev ชั่วคราว");
  }
  cachedKey = Buffer.from(
    hkdfSync("sha256", material, "baijing-reveal-salt-v1", "reveal-token", 32),
  );
  return cachedKey;
}

export function sealReveal(questionId: string, boxes: RevealedHintBox[]): string {
  const payload: RevealPayload = { questionId, createdAt: Date.now(), boxes };
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getRevealKey(), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function openReveal(token: string): RevealPayload | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getRevealKey(),
      raw.subarray(0, IV_BYTES),
    );
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const json = Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(json) as RevealPayload;
    if (
      typeof payload?.createdAt !== "number" ||
      !Array.isArray(payload.boxes) ||
      Date.now() - payload.createdAt > REVEAL_TTL_MS
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Prompts
// ────────────────────────────────────────────────────────────────────────────

const SHARED_RULES = `
สไตล์ที่ต้องใช้ (สำคัญมาก):
- ภาษาไทยแบบพูดคุย เป็นกันเอง เหมือนพิธีกรกระซิบบอกข้างเวที ไม่ใช่ภาษาตำรา
- สั้น 1 ประโยค ไม่เกิน 30 คำ ให้ทีละนิดเดียวพอ อย่ายัดหลายเบาะแสในประโยคเดียว
- ชี้ไปที่ "หลักการ" หรือ "ภาพรวม" ที่ทำให้ผู้เล่นนึกออก เช่น หน้าที่ กลไก ที่มาของคำ
  หรือการเปรียบเทียบกับของใกล้ตัว
- ถ้าคำถามอยู่ในหมวดเฉพาะทาง ให้แตะศัพท์ของหมวดนั้นนิดหนึ่งเพื่อชี้ทิศ
  เช่น หมวดสุขภาพก็ใช้ศัพท์ทางกายวิภาคหรือสรีรวิทยาเบา ๆ

ข้อห้าม:
- ห้ามพิมพ์คำตอบที่ถูกออกมาตรง ๆ และห้ามพิมพ์ข้อความของตัวเลือกแบบตรงตัว
- ห้ามใบ้จากรูปคำ เช่น จำนวนตัวอักษร อักษรตัวแรก หรือจำนวนพยางค์ — น่าเบื่อและไม่ได้ฝึกคิด
- ห้ามอ้างลำดับหรือตำแหน่งของตัวเลือก
- ห้ามบอกว่าคำใบ้นี้จริงหรือหลอก และห้ามใส่คำเตือนใด ๆ ลงในคำใบ้
`.trim();

const DIRECT_SYSTEM = `
คุณคือผู้ช่วยคำใบ้ของเกมโชว์ไทย "ใบ้จริง...ใบ้หลอก" — ตอนนี้สร้าง "คำใบ้จริง"

คำใบ้จริง:
- เป็นเบาะแสที่ถูกต้อง 100% ห้ามแต่งข้อมูล
- ให้ผู้เล่น "เห็นภาพ" ว่าคำตอบอยู่แถวไหน แต่ยังต้องคิดต่ออีกขั้นเอง
- สำหรับคำถามอัตนัยหรือโชว์ความสามารถ ให้ชี้ไปที่หลักการที่ทำให้คำตอบดี
  เช่น สิ่งที่กรรมการมองหา ลำดับที่ควรทำ หรือกับดักที่คนมักพลาด

${SHARED_RULES}
`.trim();

const DECEPTIVE_SYSTEM = `
คุณคือผู้ช่วยคำใบ้ของเกมโชว์ไทย "ใบ้จริง...ใบ้หลอก" — ตอนนี้สร้าง "คำใบ้หลอก"
เพื่อทดสอบทักษะการคิดวิเคราะห์ของผู้เล่น

โครงของคำใบ้หลอกที่ดี — ประโยคเดียว แบ่งเป็นสองท่อน:
  ท่อนแรก: ข้อเท็จจริงที่ "ถูกต้องจริง" และเกี่ยวข้องกับเรื่องนี้ เพื่อสร้างความน่าเชื่อถือ
  ท่อนหลัง: ข้อความที่ "ฟังดูสมเหตุสมผลแต่ผิด" และชี้ไปยังคำตอบที่ผิด
เชื่อมสองท่อนด้วยคำอย่าง "และ" "โดย" "แต่" ให้อ่านแล้วลื่นเหมือนเป็นเรื่องเดียวกัน

ตัวอย่างโครงที่ดี (หมวดสุขภาพ):
"น้ำดีช่วยย่อยไขมันจริง และมันถูกสร้างขึ้นในถุงเล็ก ๆ รูปลูกแพร์ใต้ชายโครงขวา"
→ ท่อนแรกจริง ท่อนหลังผิดเพราะถุงนั้นเป็นที่ "เก็บ" ไม่ใช่ที่ "สร้าง"

ห้ามทำแบบนี้ (เคยทำแล้วไม่เวิร์ก):
- ห้ามอ้างแหล่งข้อมูลปลอมที่ไม่มีอยู่จริง เช่น "ตำราเล่มนั้นบันทึกว่า..."
  หรือ "ชมรมนั้นยืนยันว่า..." เพราะผู้เล่นจับได้ทันทีและไม่ได้ฝึกคิดอะไรเลย
- ห้ามใบ้จากรูปคำ เช่น อักษรตัวแรกหรือจำนวนตัวอักษร

ข้อห้ามด้านความปลอดภัย (สำคัญที่สุด ห้ามละเมิด):
- ความเข้าใจผิดเชิงข้อเท็จจริงที่ไม่มีใครเสียหายจากการเชื่อ ใช้ได้ (เช่น อวัยวะไหนทำหน้าที่อะไร
  ปีที่เกิดเหตุการณ์ ใครเป็นคนแรก) เพราะเกมจะเฉลยให้ทุกครั้งตอนจบข้อ
- แต่ห้ามสร้างข้อความเท็จที่ "ถ้าเชื่อแล้วลงมือทำจะเกิดความเสียหายจริง"
  เช่น วิธีรักษาโรค ขนาดยา การปฐมพยาบาล ขั้นตอนทางกฎหมาย
  หรือการโอนเงิน/ลงทุนที่ทำให้สูญเงิน
- ห้ามให้ข้อมูลเท็จเกี่ยวกับบุคคล องค์กร หรือแบรนด์ที่มีอยู่จริง
- หมวดสแกม: ท่อนหลอกต้องเป็นความเข้าใจผิดที่เกมจะเฉลยกลับ ห้ามเป็นคำแนะนำที่ทำตามแล้วเสียเงินจริง

${SHARED_RULES}
`.trim();

const DECEPTIVE_ANGLES = [
  "เน้นมุมตัวเลข ปี หรือปริมาณ",
  "เน้นมุมที่มาของคำ ตัวย่อ หรือความหมายเชิงภาษา",
  "เน้นมุมบุคคล สถานที่ หรือเหตุการณ์ที่เกี่ยวข้อง",
  "เน้นมุมลำดับขั้นตอนหรือวิธีปฏิบัติ",
];

function buildHintPrompt(
  question: Question,
  angle?: string,
  kind: HintTruth = "จริง",
): string {
  const lines = [
    `หมวด: ${question.category}`,
    `ระดับความยาก: ${question.difficulty}`,
    `รูปแบบคำถาม: ${
      question.format === "choice"
        ? "ปรนัย"
        : question.format === "open"
          ? "อัตนัย (ผู้เล่นพิมพ์ตอบ)"
          : "โชว์ความสามารถ (ผู้เล่นต้องแสดงสด)"
    }`,
    `คำถาม: ${question.prompt}`,
  ];
  if (question.choices) lines.push(`ตัวเลือก: ${question.choices.join(" | ")}`);
  if (question.correctAnswer) {
    lines.push(`คำตอบที่ถูก (ข้อมูลลับ ห้ามเปิดเผย): ${question.correctAnswer}`);
  }
  if (question.rubric) lines.push(`เกณฑ์ให้คะแนน (ข้อมูลลับ): ${question.rubric}`);
  if (question.keyPoints?.length) {
    lines.push(`ประเด็นที่คำตอบดีควรมี (ข้อมูลลับ): ${question.keyPoints.join(" / ")}`);
  }
  if (question.explanation) lines.push(`บริบทเพิ่มเติม: ${question.explanation}`);

  // ป้อนคำใบ้ที่ทีมงานเขียนไว้เป็นตัวอย่างน้ำเสียงและระดับความยาก
  const samples = kind === "จริง" ? question.hints?.real : question.hints?.fake;
  if (samples?.length) {
    lines.push(
      "",
      `ตัวอย่างคำใบ้${kind}ของข้อนี้ที่ทีมงานเขียนไว้ — ให้ยึดน้ำเสียงและระดับความยากแบบนี้`,
      "แต่ห้ามลอกซ้ำ ให้เขียนขึ้นใหม่คนละมุม:",
      ...samples.map((s) => `- ${s}`),
    );
  }
  if (angle) lines.push("", `มุมที่ต้องใช้ในคำใบ้ชุดนี้: ${angle}`);
  lines.push(
    "",
    "สร้างคำใบ้ตามภารกิจ แล้วตอบเป็น JSON ตามสคีมา",
    "rationale = อธิบายสั้น ๆ ว่าทำไมออกแบบคำใบ้นี้แบบนี้ (สำหรับทีมงานเท่านั้น)",
  );
  return lines.join("\n");
}

const HINT_SCHEMA = {
  type: "object",
  properties: {
    hint: { type: "string", description: "ตัวคำใบ้ ภาษาไทย 1-2 ประโยค" },
    rationale: { type: "string", description: "เหตุผลการออกแบบ สำหรับทีมงาน" },
  },
  required: ["hint", "rationale"],
  additionalProperties: false,
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Claude helpers
// ────────────────────────────────────────────────────────────────────────────

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export function parseJsonLoose<T>(raw: string): T | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}

interface HintPayload {
  hint: string;
  rationale: string;
}

async function callClaudeJson<T>(
  system: string,
  userPrompt: string,
  schema: Record<string, unknown>,
  maxTokens: number,
  tag: string,
): Promise<T | null> {
  const client = getAnthropic();
  if (!client) return null;
  try {
    const message = await client.messages.create(
      {
        model: HINT_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: userPrompt }],
        output_config: { effort: "low", format: { type: "json_schema", schema } },
      },
      { timeout: 40_000 },
    );
    if (message.stop_reason === "refusal") {
      console.warn(`[${tag}] Claude ปฏิเสธคำขอ:`, message.stop_details);
      return null;
    }
    if (message.stop_reason === "max_tokens") {
      console.warn(`[${tag}] คำตอบถูกตัดกลางคัน (max_tokens)`);
      return null;
    }
    return parseJsonLoose<T>(extractText(message));
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error(`[${tag}] Anthropic API error ${error.status}:`, error.message);
    } else {
      console.error(`[${tag}] เรียก Claude ไม่สำเร็จ:`, error);
    }
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// โหมดสำรอง (ไม่มี API key หรือ API ล่ม)
// ────────────────────────────────────────────────────────────────────────────

/**
 * โหมดสำรองหยิบคำใบ้เชิงเนื้อหาที่เขียนไว้ในตัวคำถาม (`question.hints`)
 * ใช้ index ของกล่องเป็นตัวเลือก จึงไม่มีทางได้ข้อความซ้ำกันในเกมเดียว
 *
 * เดิมโหมดนี้ใบ้จากรูปคำ (อักษรตัวแรก/จำนวนตัวอักษร) และอ้างแหล่งข้อมูลปลอม
 * ซึ่งไม่ได้ฝึกคิดอะไรเลยและผู้เล่นจับได้ทันที จึงเลิกใช้ทั้งหมด
 */
function pickSeed(list: string[] | undefined, seed: number): string | null {
  if (!list?.length) return null;
  return list[seed % list.length];
}

/** ใช้เมื่อคำถามที่เพิ่มเองจากหลังบ้านยังไม่ได้เขียนคำใบ้ไว้ */
function genericTrue(question: Question): string {
  return question.format === "choice"
    ? `ลองตัดตัวเลือกที่ไม่เกี่ยวกับ${question.category}ออกก่อน แล้วดูว่าเหลืออะไร`
    : `กรรมการมองหาคำตอบที่ลงรายละเอียดเป็นรูปธรรม มากกว่าคำตอบที่พูดกว้าง ๆ`;
}

function genericFalse(question: Question, seed: number): string {
  if (question.choices?.length && question.correctAnswer) {
    const wrong = question.choices.filter((c) => c !== question.correctAnswer);
    const decoy = wrong[seed % (wrong.length || 1)];
    if (decoy) {
      return `ข้อนี้อยู่ในหมวด${question.category}จริง และคำตอบที่คนส่วนใหญ่ตอบถูกกันคือ “${decoy}”`;
    }
  }
  return "การตอบให้ตรงคำถามสำคัญจริง โดยคำตอบที่สั้นที่สุดมักได้คะแนนสูงที่สุดเสมอ";
}

function fallbackTrue(question: Question, seed: number): HintPayload {
  return {
    hint: pickSeed(question.hints?.real, seed) ?? genericTrue(question),
    rationale:
      "โหมดสำรอง — หยิบเบาะแสเชิงเนื้อหาที่ทีมงานเขียนไว้ในข้อนี้ ชี้ทางด้วยหลักการโดยไม่เฉลย",
  };
}

function fallbackFalse(question: Question, seed: number): HintPayload {
  return {
    hint: pickSeed(question.hints?.fake, seed) ?? genericFalse(question, seed),
    rationale:
      "โหมดสำรอง — ท่อนแรกเป็นข้อเท็จจริงที่ถูกต้อง ท่อนหลังเป็นความเข้าใจผิดที่ฟังดูสมเหตุสมผล " +
      "จึงต้องอ่านให้ละเอียดถึงจะจับได้",
  };
}

// ────────────────────────────────────────────────────────────────────────────
// สร้างกล่องคำใบ้ 4 กล่อง
// ────────────────────────────────────────────────────────────────────────────

const BOX_LABELS = ["A", "B", "C", "D"];

export interface HintBoxResult {
  boxes: RevealedHintBox[];
  source: "claude" | "fallback";
}

/**
 * สร้าง 4 กล่อง โดยบังคับให้มีทั้งจริงและหลอกอย่างน้อยอย่างละ 1
 * (สัดส่วนสุ่มเป็น 1:3, 2:2 หรือ 3:1) แล้วสลับตำแหน่งก่อนติดป้าย A-D
 */
export async function generateHintBoxes(question: Question): Promise<HintBoxResult> {
  const trueCount = 1 + Math.floor(Math.random() * (HINT_BOX_COUNT - 1)); // 1..3
  const plan: HintTruth[] = [
    ...Array<HintTruth>(trueCount).fill("จริง"),
    ...Array<HintTruth>(HINT_BOX_COUNT - trueCount).fill("หลอก"),
  ];

  let deceptiveIndex = 0;
  const jobs = plan.map(async (truth, index) => {
    const angle =
      truth === "หลอก"
        ? DECEPTIVE_ANGLES[deceptiveIndex++ % DECEPTIVE_ANGLES.length]
        : undefined;
    const payload = await callClaudeJson<HintPayload>(
      truth === "จริง" ? DIRECT_SYSTEM : DECEPTIVE_SYSTEM,
      buildHintPrompt(question, angle, truth),
      HINT_SCHEMA,
      6000,
      "hint",
    );
    return { truth, index, payload: payload?.hint ? payload : null };
  });

  const settled = await Promise.all(jobs);
  const usedFallback = settled.some((s) => s.payload === null);

  const boxes: RevealedHintBox[] = settled.map(({ truth, index, payload }) => {
    const resolved =
      payload ??
      (truth === "จริง" ? fallbackTrue(question, index) : fallbackFalse(question, index));
    return {
      id: randomUUID(),
      label: "",
      text: resolved.hint,
      truth,
      rationale: resolved.rationale,
    };
  });

  // สลับตำแหน่งก่อน แล้วค่อยติดป้าย A-D เพื่อไม่ให้เดาได้จากลำดับที่สร้าง
  for (let i = boxes.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [boxes[i], boxes[j]] = [boxes[j], boxes[i]];
  }
  boxes.forEach((box, i) => {
    box.label = BOX_LABELS[i] ?? String(i + 1);
  });

  return { boxes, source: usedFallback ? "fallback" : "claude" };
}

// ────────────────────────────────────────────────────────────────────────────
// ตรวจคำตอบอัตนัย
// ────────────────────────────────────────────────────────────────────────────

const GRADE_SYSTEM = `
คุณคือกรรมการของเกมโชว์ไทย ทำหน้าที่ตรวจคำตอบแบบอัตนัยอย่างเป็นธรรมและให้กำลังใจ

หลักการให้คะแนน:
- ยึดตาม rubric ที่ได้รับเป็นหลัก ไม่เอาความชอบส่วนตัวมาตัดสิน
- ให้คะแนนตามสาระที่ตอบได้ ไม่ตัดคะแนนเพราะสำนวนหรือการสะกด
- คำตอบสั้นแต่ตรงประเด็นควรได้คะแนนดีกว่าคำตอบยาวที่วนไปมา
- ถ้าคำตอบว่างเปล่า ไม่เกี่ยวกับคำถาม หรือเป็นการมั่ว ให้ 0-10
- ให้ feedback ที่นำไปใช้พัฒนาต่อได้จริง ไม่ใช่คำชมลอย ๆ
- ภาษาไทย กระชับ
`.trim();

const GRADE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", description: "คะแนน 0-100 ตาม rubric" },
    feedback: { type: "string", description: "สรุปผลการตรวจ 1-2 ประโยค ภาษาไทย" },
    strengths: {
      type: "array",
      description: "สิ่งที่ทำได้ดี 1-3 ข้อ",
      items: { type: "string" },
    },
    improvements: {
      type: "array",
      description: "สิ่งที่ควรเพิ่ม 1-3 ข้อ",
      items: { type: "string" },
    },
  },
  required: ["score", "feedback", "strengths", "improvements"],
  additionalProperties: false,
} as const;

export interface GradeResult {
  score: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
  source: "claude" | "fallback";
}

/** ตรวจแบบหยาบ ๆ ตอนไม่มี API key — นับว่าแตะประเด็นสำคัญกี่ข้อ */
function fallbackGrade(question: Question, answer: string): GradeResult {
  const text = answer.trim();
  if (text.length < 10) {
    return {
      score: 0,
      feedback: "คำตอบสั้นเกินกว่าจะประเมินได้",
      strengths: [],
      improvements: ["ลองเขียนให้ครบว่าจะทำอะไร กับใคร และเพราะอะไร"],
      source: "fallback",
    };
  }
  const points = question.keyPoints ?? [];
  const hit = points.filter((p) =>
    Array.from(p.matchAll(/[฀-๿a-zA-Z]{3,}/g))
      .slice(0, 3)
      .some((m) => text.includes(m[0])),
  );
  const coverage = points.length > 0 ? hit.length / points.length : 0.5;
  const lengthBonus = Math.min(0.25, text.length / 1200);
  const score = Math.round(Math.min(100, (coverage * 0.75 + lengthBonus) * 100));
  return {
    score,
    feedback:
      `โหมดสำรอง (ไม่มี ANTHROPIC_API_KEY) — ประเมินหยาบ ๆ จากการแตะประเด็นสำคัญ ` +
      `${hit.length}/${points.length} ข้อ`,
    strengths: hit.map((p) => `พูดถึง: ${p}`),
    improvements: points.filter((p) => !hit.includes(p)).map((p) => `ยังไม่ได้พูดถึง: ${p}`),
    source: "fallback",
  };
}

export async function gradeOpenAnswer(
  question: Question,
  answer: string,
): Promise<GradeResult> {
  if (!answer.trim()) {
    return {
      score: 0,
      feedback: "ไม่ได้ตอบภายในเวลา",
      strengths: [],
      improvements: [],
      source: "fallback",
    };
  }

  const userPrompt = [
    `คำถาม: ${question.prompt}`,
    `หมวด: ${question.category} · ระดับ: ${question.difficulty}`,
    question.rubric ? `เกณฑ์ให้คะแนน: ${question.rubric}` : "",
    question.keyPoints?.length
      ? `ประเด็นที่คำตอบดีควรมี: ${question.keyPoints.join(" / ")}`
      : "",
    "",
    "คำตอบของผู้เล่น:",
    `"""${answer.trim()}"""`,
    "",
    "ตรวจแล้วตอบเป็น JSON ตามสคีมา",
  ]
    .filter(Boolean)
    .join("\n");

  const parsed = await callClaudeJson<{
    score?: number;
    feedback?: string;
    strengths?: string[];
    improvements?: string[];
  }>(GRADE_SYSTEM, userPrompt, GRADE_SCHEMA, 6000, "grade");

  if (!parsed || typeof parsed.score !== "number") {
    return fallbackGrade(question, answer);
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(parsed.score))),
    feedback: parsed.feedback?.trim() || "ตรวจเรียบร้อย",
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 3) : [],
    improvements: Array.isArray(parsed.improvements)
      ? parsed.improvements.slice(0, 3)
      : [],
    source: "claude",
  };
}
