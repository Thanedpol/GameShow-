import "server-only";

import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { HintType, Question, RevealedHint } from "./types";

// ────────────────────────────────────────────────────────────────────────────
// Anthropic client
// ────────────────────────────────────────────────────────────────────────────

export const HINT_MODEL = process.env.HINT_MODEL?.trim() || "claude-opus-5";

let cachedClient: Anthropic | null = null;

export function getAnthropic(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey, maxRetries: 1 });
  }
  return cachedClient;
}

// ────────────────────────────────────────────────────────────────────────────
// In-memory reveal store
// เก็บ label "จริง/หลอก" ไว้ฝั่งเซิร์ฟเวอร์เท่านั้น — frontend เห็นแค่ revealId
// (prototype: หายเมื่อ restart server ตามที่โจทย์ยอมรับได้)
// ────────────────────────────────────────────────────────────────────────────

export interface StoredReveal {
  revealId: string;
  questionId: string;
  createdAt: number;
  hints: RevealedHint[];
}

const REVEAL_TTL_MS = 60 * 60 * 1000; // 1 ชั่วโมง

const globalStore = globalThis as unknown as {
  __hintRevealStore?: Map<string, StoredReveal>;
};

const revealStore: Map<string, StoredReveal> =
  globalStore.__hintRevealStore ?? (globalStore.__hintRevealStore = new Map());

function pruneStore() {
  const cutoff = Date.now() - REVEAL_TTL_MS;
  for (const [key, value] of revealStore) {
    if (value.createdAt < cutoff) revealStore.delete(key);
  }
}

export function saveReveal(questionId: string, hints: RevealedHint[]): StoredReveal {
  pruneStore();
  const record: StoredReveal = {
    revealId: randomUUID(),
    questionId,
    createdAt: Date.now(),
    hints,
  };
  revealStore.set(record.revealId, record);
  return record;
}

export function getReveal(revealId: string): StoredReveal | undefined {
  pruneStore();
  return revealStore.get(revealId);
}

// ────────────────────────────────────────────────────────────────────────────
// Prompts
// ────────────────────────────────────────────────────────────────────────────

const SHARED_RULES = `
ข้อกำหนดร่วมทุกกรณี:
- เขียนเป็นภาษาไทย น้ำเสียงแบบพิธีกรเกมโชว์ กระชับ อ่านออกเสียงได้ลื่น
- ความยาว 1 ประโยค (ไม่เกิน 2 ประโยคสั้น ๆ) ไม่เกิน 45 คำ
- ห้ามเอ่ยข้อความของตัวเลือกใด ๆ แบบตรงตัว และห้ามพิมพ์คำตอบที่ถูกออกมาตรง ๆ
- ห้ามอ้างถึงลำดับหรือตำแหน่งของตัวเลือก (เช่น "ข้อ 2" หรือ "ตัวเลือกสุดท้าย")
- ห้ามบอกว่าส่วนไหนของคำใบ้จริงหรือหลอก และห้ามใส่คำเตือนใด ๆ ลงในคำใบ้
`.trim();

const DIRECT_SYSTEM = `
คุณคือ "ผู้ช่วยคำใบ้" ของเกมโชว์ตอบคำถามภาษาไทยชื่อ "ใบ้จริง...ใบ้หลอก"
ภารกิจตอนนี้: สร้างคำใบ้แบบ "ใบ้ตรง"

นิยามของ "ใบ้ตรง":
- ต้องเป็นเบาะแสที่ตรวจสอบได้จริง เป็นข้อเท็จจริงที่ถูกต้อง 100% ห้ามแต่งข้อมูลขึ้นมา
- ต้องเข้าใกล้คำตอบมากพอที่ผู้เล่นซึ่งมีความรู้พื้นฐานจะปะติดปะต่อได้
- แต่ต้อง "ไม่เฉลยตรง ๆ" ผู้เล่นยังต้องคิดต่ออีกหนึ่งขั้น
- เทคนิคที่ใช้ได้: บริบททางประวัติศาสตร์, ที่มาของคำ/ตัวย่อ, หน้าที่หรือกลไก, ตัวเลขที่เกี่ยวข้อง, การเปรียบเทียบกับสิ่งใกล้เคียง

${SHARED_RULES}
`.trim();

const DECEPTIVE_SYSTEM = `
คุณคือ "ผู้ช่วยคำใบ้" ของเกมโชว์ตอบคำถามภาษาไทยชื่อ "ใบ้จริง...ใบ้หลอก"
ภารกิจตอนนี้: สร้างคำใบ้แบบ "ใบ้ลวง" สำหรับทดสอบทักษะการคิดวิเคราะห์ของผู้เล่น

นิยามของ "ใบ้ลวง" — ประโยคเดียวที่ผสมสองอย่างเข้าด้วยกันอย่างแนบเนียน:
  (ก) เบาะแสจริง 1 อย่าง — ข้อเท็จจริงที่ถูกต้องและเกี่ยวข้องกับคำตอบที่ถูก
  (ข) เบาะแสหลอก 1 อย่าง — สร้างจากเรื่องสมมติที่ไม่เป็นอันตราย และชี้ไปยังตัวเลือกที่ผิด
ทั้งสองส่วนต้องกลืนกันจนแยกยาก ผู้เล่นต้องใช้วิจารณญาณเองว่าจะเชื่อส่วนไหน

ข้อห้ามด้านความปลอดภัย (สำคัญที่สุด ห้ามละเมิดเด็ดขาด):
- ห้ามสร้างข้อมูลเท็จเกี่ยวกับ การแพทย์ สุขภาพ ยา การรักษา โภชนาการ กฎหมาย
  หรือการเงิน/การลงทุน ที่ผู้ฟังอาจนำไปใช้จริงแล้วเกิดความเสียหาย
- ถ้าคำถามอยู่ในหมวดที่อ่อนไหวเหล่านั้น ให้สร้างส่วน "หลอก" จาก trivia สมมติที่ไร้พิษภัยแทน
  เช่น อ้างชื่อตำรา/รายการโทรทัศน์/ชมรม/ตัวละคร/เมืองที่ไม่มีอยู่จริง หรือ
  "ธรรมเนียมของสมาคมสมมติ" โดยไม่แตะข้อเท็จจริงเชิงการแพทย์/การเงินที่คนนำไปอ้างอิงต่อได้
- ห้ามพาดพิงบุคคล องค์กร หรือแบรนด์ที่มีอยู่จริงในเชิงให้ข้อมูลเท็จเกี่ยวกับเขา
- ส่วนที่หลอกต้องเป็นเรื่องที่ "ตรวจสอบแล้วพบว่าไม่มีอยู่จริง" ไม่ใช่การบิดเบือนข้อเท็จจริงที่มีอยู่

${SHARED_RULES}
`.trim();

function buildUserPrompt(
  question: Question,
  correctAnswer: string,
  variantNote?: string,
): string {
  const lines = [
    `หมวด: ${question.category}`,
    `ระดับ: ${question.stage} (${question.pointValue} คะแนน)`,
    `คำถาม: ${question.prompt}`,
    `ตัวเลือกทั้งหมด: ${question.choices.join(" | ")}`,
    `คำตอบที่ถูกต้อง (ข้อมูลลับ ห้ามเปิดเผยในคำใบ้): ${correctAnswer}`,
  ];
  if (question.explanation) {
    lines.push(`บริบทเพิ่มเติมสำหรับคุณ: ${question.explanation}`);
  }
  if (variantNote) {
    lines.push(`มุมที่ต้องใช้ในคำใบ้ชุดนี้: ${variantNote}`);
  }
  lines.push(
    "",
    "สร้างคำใบ้ตามภารกิจ แล้วตอบกลับเป็น JSON ตามสคีมาที่กำหนด",
    "โดย rationale ให้อธิบายสั้น ๆ เป็นภาษาไทยว่าทำไมคุณออกแบบคำใบ้นี้แบบนี้ " +
      "(ข้อความนี้ใช้ภายในทีมงานเท่านั้น ผู้เล่นไม่เห็นระหว่างเกม)",
  );
  return lines.join("\n");
}

const HINT_JSON_SCHEMA = {
  type: "object",
  properties: {
    hint: {
      type: "string",
      description: "ตัวคำใบ้ที่จะอ่านให้ผู้เล่นฟัง ภาษาไทย 1-2 ประโยค",
    },
    rationale: {
      type: "string",
      description:
        "เหตุผลเบื้องหลังการออกแบบคำใบ้นี้ ภาษาไทย 1-2 ประโยค สำหรับทีมงานเท่านั้น",
    },
  },
  required: ["hint", "rationale"],
  additionalProperties: false,
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Claude call
// ────────────────────────────────────────────────────────────────────────────

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/** เผื่อกรณีโมเดลห่อ JSON ด้วย code fence หรือมีข้อความนำ */
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

async function callClaudeForHint(
  system: string,
  userPrompt: string,
): Promise<HintPayload | null> {
  const client = getAnthropic();
  if (!client) return null;

  try {
    const message = await client.messages.create(
      {
        model: HINT_MODEL,
        // เผื่อพื้นที่ให้ thinking token ด้วย (บนโมเดลรุ่นใหม่ thinking เปิดอยู่โดยดีฟอลต์
        // และ max_tokens นับรวม thinking + ข้อความตอบกลับ)
        max_tokens: 8000,
        system,
        messages: [{ role: "user", content: userPrompt }],
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: HINT_JSON_SCHEMA },
        },
      },
      { timeout: 30_000 },
    );

    if (message.stop_reason === "refusal") {
      console.warn("[hint] Claude ปฏิเสธคำขอ:", message.stop_details);
      return null;
    }
    if (message.stop_reason === "max_tokens") {
      console.warn("[hint] คำตอบถูกตัดกลางคัน (max_tokens) — ใช้คำใบ้สำรองแทน");
      return null;
    }

    const parsed = parseJsonLoose<HintPayload>(extractText(message));
    if (!parsed?.hint) {
      console.warn("[hint] แปลง JSON จากโมเดลไม่สำเร็จ — ใช้คำใบ้สำรองแทน");
      return null;
    }
    return {
      hint: parsed.hint.trim(),
      rationale: (parsed.rationale ?? "").trim() || "ไม่มีคำอธิบายจากโมเดล",
    };
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error(`[hint] Anthropic API error ${error.status}:`, error.message);
    } else {
      console.error("[hint] เรียก Claude ไม่สำเร็จ:", error);
    }
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Fallback (ไม่มี ANTHROPIC_API_KEY หรือ API ล่ม → เกมยังเล่นต่อได้)
// ────────────────────────────────────────────────────────────────────────────

const FICTIONAL_SOURCES = [
  "ตำรา “พจนานุกรมกลับด้าน ฉบับเมืองสมมติ”",
  "รายการวิทยุ “ครึ่งชั่วโมงหลงทาง”",
  "ชมรมนักสะสมของไม่มีจริงแห่งเกาะมะลิลม",
  "คู่มือประจำหอสมุดเมืองแคนดาเลีย",
];

function firstGrapheme(text: string): string {
  return Array.from(text)[0] ?? "?";
}

function wrongChoiceFor(question: Question, correctAnswer: string, seed: number): string {
  const wrong = question.choices.filter((c) => c !== correctAnswer);
  if (wrong.length === 0) return "ตัวเลือกอื่น";
  return wrong[seed % wrong.length];
}

function fallbackDirect(question: Question, correctAnswer: string): HintPayload {
  const chars = Array.from(correctAnswer).length;
  return {
    hint:
      `เบาะแสจริง: คำตอบอยู่ในหมวด${question.category} ขึ้นต้นด้วยอักษร “${firstGrapheme(
        correctAnswer,
      )}” ` + `และมีความยาวรวม ${chars} ตัวอักษร`,
    rationale:
      "โหมดสำรอง (ไม่มี ANTHROPIC_API_KEY) — ใช้คุณสมบัติของตัวคำตอบที่ตรวจสอบได้จริง " +
      "แต่ยังไม่เฉลยตรง ๆ",
  };
}

function fallbackDeceptive(
  question: Question,
  correctAnswer: string,
  seed: number,
): HintPayload {
  const decoy = wrongChoiceFor(question, correctAnswer, seed);
  const source = FICTIONAL_SOURCES[seed % FICTIONAL_SOURCES.length];
  return {
    hint:
      `คำตอบขึ้นต้นด้วยอักษร “${firstGrapheme(correctAnswer)}” ` +
      `ขณะที่${source}บันทึกไว้ว่าคำเฉลยของข้อนี้คือ “${decoy}”`,
    rationale:
      "โหมดสำรอง (ไม่มี ANTHROPIC_API_KEY) — ผสมเบาะแสจริง 1 อย่าง (อักษรขึ้นต้น) " +
      "กับเบาะแสหลอกที่อ้างแหล่งข้อมูลสมมติซึ่งไม่มีอยู่จริง จึงไม่สร้างข้อมูลเท็จที่เป็นอันตราย",
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

const DECEPTIVE_VARIANTS = [
  "เน้นมุมตัวเลข ปี พ.ศ./ค.ศ. หรือปริมาณ",
  "เน้นมุมที่มาของคำ ตัวย่อ หรือความหมายเชิงภาษา",
  "เน้นมุมบุคคล สถานที่ หรือเหตุการณ์ที่เกี่ยวข้อง",
];

export interface GenerateResult {
  hints: RevealedHint[];
  source: "claude" | "fallback";
}

/** สร้างคำใบ้ 1 ชุด สำหรับโหมด "ตรง" หรือ "ลวง" */
export async function generateSingleHint(
  question: Question,
  correctAnswer: string,
  mode: HintType,
): Promise<GenerateResult> {
  const system = mode === "ตรง" ? DIRECT_SYSTEM : DECEPTIVE_SYSTEM;
  const user = buildUserPrompt(question, correctAnswer);
  const payload = await callClaudeForHint(system, user);

  const seed = Math.floor(Math.random() * 997);
  const resolved =
    payload ??
    (mode === "ตรง"
      ? fallbackDirect(question, correctAnswer)
      : fallbackDeceptive(question, correctAnswer, seed));

  return {
    source: payload ? "claude" : "fallback",
    hints: [
      {
        id: randomUUID(),
        text: resolved.hint,
        // "ใบ้ตรง" = เบาะแสจริงล้วน / "ใบ้ลวง" = มีส่วนที่หลอกปนอยู่
        truth: mode === "ตรง" ? "จริง" : "หลอก",
        mode,
        rationale: resolved.rationale,
      },
    ],
  };
}

/**
 * AI Duel Final — สร้าง 3 ชุดพร้อมกัน (1 จริง + 2 หลอกจากคนละ prompt)
 * แล้วสลับลำดับแบบสุ่ม เพื่อไม่ให้เดาได้จากตำแหน่ง
 */
export async function generateFinalHints(
  question: Question,
  correctAnswer: string,
): Promise<GenerateResult> {
  const seed = Math.floor(Math.random() * 997);

  const jobs: Array<Promise<{ payload: HintPayload | null; mode: HintType; index: number }>> =
    [
      callClaudeForHint(DIRECT_SYSTEM, buildUserPrompt(question, correctAnswer)).then(
        (payload) => ({ payload, mode: "ตรง" as HintType, index: 0 }),
      ),
      callClaudeForHint(
        DECEPTIVE_SYSTEM,
        buildUserPrompt(question, correctAnswer, DECEPTIVE_VARIANTS[0]),
      ).then((payload) => ({ payload, mode: "ลวง" as HintType, index: 1 })),
      callClaudeForHint(
        DECEPTIVE_SYSTEM,
        buildUserPrompt(question, correctAnswer, DECEPTIVE_VARIANTS[1]),
      ).then((payload) => ({ payload, mode: "ลวง" as HintType, index: 2 })),
    ];

  const settled = await Promise.all(jobs);
  const usedFallback = settled.some((s) => s.payload === null);

  const hints: RevealedHint[] = settled.map(({ payload, mode, index }) => {
    const resolved =
      payload ??
      (mode === "ตรง"
        ? fallbackDirect(question, correctAnswer)
        : fallbackDeceptive(question, correctAnswer, seed + index));
    return {
      id: randomUUID(),
      text: resolved.hint,
      truth: mode === "ตรง" ? "จริง" : "หลอก",
      mode,
      rationale: resolved.rationale,
    };
  });

  // Fisher-Yates — สลับตำแหน่งไม่ให้ชุดจริงอยู่ที่เดิมเสมอ
  for (let i = hints.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [hints[i], hints[j]] = [hints[j], hints[i]];
  }

  return { hints, source: usedFallback ? "fallback" : "claude" };
}
