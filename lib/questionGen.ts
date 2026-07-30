import "server-only";

import { SHARED_RULES } from "./hintEngine";
import { callLlmJson, isChoiceReady, resolveLlm, type LlmChoiceInput } from "./llm";
import { drawPerformanceTasks, drawSeeds, type QuestionSeed } from "./questionSeeds";
import { harvest, verifyLinks, type FeedGroup, type NewsItem } from "./sources";
import {
  HINT_ZONES,
  type Category,
  type Difficulty,
  type HintZone,
  type Question,
  type QuestionFormat,
  type Stage,
} from "./types";

/**
 * ตัวแต่งคำถามสดจากข่าวจริง
 *
 * ทำไมไม่ปล่อยให้โมเดลนึกคำถามเอาเอง: โมเดลจะวนอยู่กับความรู้ยอดนิยมในหัวมันเอง
 * ถามซ้ำเรื่องเดิม ๆ และไม่มีทางรู้ว่าอะไรเพิ่งเกิดขึ้น การป้อนข่าวจริงเข้าไป
 * ทำให้คำถามเปลี่ยนตามโลกจริงทุกวันโดยไม่ต้องแก้โค้ด
 *
 * ทำไมยังต้องมีตัวตรวจฝั่งเรา: โมเดลแต่งเฉลยผิดได้ ปรนัยที่เฉลยผิดคือของเสีย
 * ที่ผู้เล่นจับได้ทันที ทุกข้อจึงต้องผ่าน validateQuestion() ก่อนถึงมือผู้เล่น
 */

const CATEGORIES: Category[] = [
  "สแกม",
  "การเงิน",
  "AI",
  "สุขภาพ",
  "ที่ทำงาน",
  "ชีวิตจริง",
  "สื่อสาร",
  "ตรรกะ",
];

const DIFFICULTIES: Difficulty[] = ["ง่าย", "กลาง", "ยาก"];

// ────────────────────────────────────────────────────────────────────────────
// Prompt
// ────────────────────────────────────────────────────────────────────────────

const SYSTEM = `
คุณคือคนเขียนคำถามของเกมโชว์ไทย "ใบ้จริง...ใบ้หลอก"

หน้าที่: แต่งคำถามใหม่จากข่าว/บทความจริงที่ได้รับมา พร้อมคำใบ้จริงและคำใบ้หลอกของแต่ละข้อ

หัวใจของคำถามที่ดีในเกมนี้:
- ต้องพาผู้เล่นไปเจอ "ปัญหาชีวิตจริงหรือโลกการทำงาน" ที่เอาไปใช้ต่อได้จริง
  ไม่ใช่คำถามความจำแบบท่องจำว่าใครทำอะไรที่ไหนเมื่อไหร่
- ผู้เล่นที่ไม่เคยอ่านข่าวชิ้นนั้นก็ต้องตอบได้ ถ้าคิดเป็น — ข่าวเป็นแค่ "ที่มา"
  ของประเด็น ไม่ใช่ตัวข้อสอบวัดว่าอ่านข่าวหรือยัง
- ห้ามถามเรื่องที่ต้องรู้ชื่อบริษัท ตัวเลข หรือวันที่เฉพาะจากข่าวชิ้นนั้น

ข้อห้ามเรื่องแหล่งที่มา (สำคัญ):
- ห้ามคัดลอกข้อความจากข่าวมาตรง ๆ ให้เขียนขึ้นใหม่ด้วยคำของตัวเองเสมอ
- ถ้าโจทย์ให้ "อ่านออกเสียง" ต้องเขียนย่อหน้านั้นขึ้นใหม่เอง ห้ามวางเนื้อข่าวต้นฉบับ
- ห้ามเอ่ยชื่อบุคคลจริงในลักษณะที่ทำให้เข้าใจผิดเกี่ยวกับตัวเขา

ข้อห้ามเรื่องเนื้อหา:
- ห้ามแตะเรื่องความรุนแรง ความตาย ภัยพิบัติ คดีความ การเมือง ศาสนา หรือความขัดแย้งระหว่างประเทศ
  ถ้าข่าวชิ้นไหนเป็นแนวนั้น ให้ข้ามไปใช้ชิ้นอื่น
- ห้ามให้คำแนะนำทางการแพทย์ กฎหมาย หรือการเงินที่เฉพาะเจาะจงจนคนเอาไปทำตามแล้วเสียหาย

รูปแบบคำถามมี 3 แบบ:
  choice      = ปรนัย 4 ตัวเลือก มีคำตอบถูก 1 ข้อ
  open        = อัตนัย ผู้เล่นพิมพ์ตอบเป็นข้อความ แล้วมีคนตรวจตาม rubric
  performance = โชว์ความสามารถสด ๆ บนเวที (พูด เล่า ร้อง พิตช์) แล้วพิมพ์สรุปสิ่งที่ทำให้ AI ตรวจตาม rubric

กติกาของแต่ละแบบ:
- choice: ตัวเลือกทั้ง 4 ต้องดูน่าเชื่อพอกัน ความยาวใกล้เคียงกัน ห้ามมีข้อไหนยาวผิดปกติ
  หรือใช้คำอย่าง "ทั้งหมดที่กล่าวมา" ที่เดาได้ทันที · correctAnswer ต้องตรงกับข้อความ
  ในตัวเลือกข้อหนึ่งแบบเป๊ะทุกตัวอักษร
- open: ต้องมี rubric บอกว่ากรรมการดูอะไร และ keyPoints 2-4 ข้อที่คำตอบดีควรมี
- performance: ต้องมี task บอกชัดว่าผู้เล่นต้องทำอะไรบนเวทีภายในเวลาที่กำหนด และมี rubric

โจทย์ "หาจุดผิดจากภาพ" (บางข้อเท่านั้น ตามที่บรีฟกำหนด):
- ใส่ imagePrompt = คำอธิบายภาพที่จะวาด บอกข้อความไทยทุกบรรทัดที่ต้องมีในภาพ
  แล้วระบุให้ชัดว่าจุดผิดคืออะไรและอยู่ตรงไหน
- ตัวคำถาม (prompt) ต้องอ่านรู้เรื่องแม้ยังไม่เห็นภาพ เช่น
  "ดูงบรายเดือนนี้แล้วบอกว่าตัวเลขบรรทัดไหนไม่สมเหตุสมผล และควรเป็นเท่าไร"
- ใส่ errorZone บอกว่าจุดผิดอยู่โซนไหนของภาพ (บนซ้าย/บนกลาง/.../ล่างขวา)
- ชนิดของ "จุดผิด" ที่ใช้ได้: ตัวเลขที่บวกไม่ตรง สัดส่วนที่ขัดกับข้อมูล
  ลำดับขั้นตอนที่สลับกัน หน่วยที่ผิด กราฟที่แกนบิดเบือน ข้อความที่ขัดแย้งกันเอง
- ⚠️ ห้ามสั่งวาดของปลอมที่เลียนแบบของจริง เช่น หน้าจอ SMS ธนาคาร อีเมลฟิชชิง
  ใบเสร็จปลอม หรือเอกสารราชการ — โมเดลวาดภาพจะปฏิเสธ และของแบบนั้นเอาไปใช้
  หลอกคนจริงได้ ให้ใช้ "ของที่ผิดโดยไม่ใช่ของปลอม" เช่น ตาราง กราฟ ป้ายประกาศ
  อินโฟกราฟิก แทน
- ข้อที่ไม่ใช่แนวนี้ ให้ส่ง imagePrompt และ errorZone เป็นค่าว่าง

เฉลย (explanation) — ผู้เล่นเห็นตอนจบข้อ และเป็นจุดที่ข้อมูลผิดจะสร้างความเสียหายที่สุด:
- ต้องบอก "ทำไม" ไม่ใช่แค่ "อะไร" — อธิบายหลักการที่ทำให้คำตอบนั้นถูก
  เพื่อให้ผู้เล่นตรวจสอบเหตุผลได้เอง ไม่ใช่ต้องเชื่อเพราะเกมบอก
- ยึดเฉพาะสิ่งที่แน่ใจจริง ๆ ถ้าไม่มั่นใจตัวเลขหรือชื่อเฉพาะ ให้เลี่ยงไปอธิบาย
  ด้วยหลักการแทน ดีกว่าใส่ตัวเลขที่อาจผิด
- ห้ามอ้างสถิติ ปี ชื่อองค์กร หรือชื่องานวิจัย ที่ไม่ได้อยู่ในข่าวที่ให้มา
- ถ้าเรื่องนั้นมีข้อถกเถียงหรือขึ้นกับบริบท ให้บอกตรง ๆ ว่าขึ้นกับอะไร
  อย่าฟันธงเป็นข้อเท็จจริงเดียว
- ใส่ sourceUrl ของข่าวที่ใช้เสมอเมื่ออิงข่าวชิ้นใดชิ้นหนึ่ง โดยคัดลอกลิงก์
  มาจากช่อง "ลิงก์:" ให้ตรงเป๊ะ ห้ามพิมพ์ขึ้นเองหรือดัดแปลง

คำใบ้ของทุกข้อ (ต้องมีครบทั้ง real 3 และ fake 3):
  real = เบาะแสที่ถูกต้อง 100% ชี้ทางด้วยหลักการของหมวดนั้น แต่ไม่เฉลย
  fake = ประโยคเดียวสองท่อน ท่อนแรกเป็นข้อเท็จจริงที่ถูกจริง ท่อนหลังฟังดูน่าเชื่อแต่ผิด
         และชี้ไปยังคำตอบที่ผิด · ห้ามอ้างแหล่งข้อมูลปลอมที่ไม่มีอยู่จริง
         ห้ามแต่งข้อมูลเท็จเรื่องยา การรักษา ขั้นตอนทางกฎหมาย หรือการโอนเงิน/ลงทุน

${SHARED_RULES}
`.trim();

const STAGE_BRIEF: Record<Stage, string> = {
  warmup:
    "ช่วงวอร์มอัพ — ให้ตอบได้ไม่ยากเกินไป เน้นสร้างความมั่นใจ ระดับ ง่าย ถึง กลาง",
  push: "ช่วงกลางเกม — ต้องคิดจริงจังขึ้น มีกับดักได้ ระดับ กลาง ถึง ยาก",
  final:
    "ช่วงชิงชนะเลิศ — ต้องท้าทายที่สุด ผสมการตัดสินใจหลายชั้นหรือการแสดงที่กดดัน ระดับ ยาก",
};

function newsBlock(items: NewsItem[]): string {
  return items
    .map(
      (n, i) =>
        `[${i + 1}] (${n.source} · ${n.region}) ${n.title}` +
        (n.summary ? `\n    ${n.summary}` : "") +
        `\n    ลิงก์: ${n.link}`,
    )
    .join("\n");
}

function seedBlock(seeds: QuestionSeed[], tasks: string[]): string {
  const lines = seeds.map(
    (s, i) => `[${i + 1}] เรื่อง: ${s.domain} · มุม: ${s.angle} · ทักษะที่อยากให้ได้: ${s.skill}`,
  );
  if (tasks.length > 0) {
    lines.push("", "แม่แบบโจทย์โชว์ความสามารถ (เลือกไปดัดแปลงให้เข้ากับเรื่องที่ได้):");
    lines.push(...tasks.map((t) => `- ${t}`));
  }
  return lines.join("\n");
}

interface BuildPromptArgs {
  stage: Stage;
  count: number;
  formatPlan: QuestionFormat[];
  seeds: QuestionSeed[];
  tasks: string[];
  news: NewsItem[];
  avoid: string[];
  imageCount: number;
}

function buildPrompt(args: BuildPromptArgs): string {
  const formatCount = args.formatPlan.reduce<Record<string, number>>((acc, f) => {
    acc[f] = (acc[f] ?? 0) + 1;
    return acc;
  }, {});

  const lines = [
    `ช่วงของเกม: ${args.stage} — ${STAGE_BRIEF[args.stage]}`,
    `จำนวนที่ต้องแต่ง: ${args.count} ข้อ`,
    "",
    `ในชุดนี้ให้เป็นโจทย์ "หาจุดผิดจากภาพ" ${args.imageCount} ข้อ (ใส่ imagePrompt กับ errorZone) ที่เหลือเป็นคำถามข้อความธรรมดา`,
    "",
    "สัดส่วนรูปแบบที่ต้องได้ (ห้ามเกินห้ามขาด):",
    ...Object.entries(formatCount).map(([f, n]) => `- ${f}: ${n} ข้อ`),
    "",
    "ข่าวและบทความจริงที่เพิ่งเผยแพร่ — ใช้เป็นวัตถุดิบ เลือกชิ้นที่เหมาะ ไม่ต้องใช้ครบทุกชิ้น:",
    newsBlock(args.news),
    "",
    `บรีฟรายข้อ — ข้อที่ ${args.count} ข้อต้องกระจายตามนี้ ห้ามกองอยู่เรื่องเดียว:`,
    seedBlock(args.seeds, args.tasks),
  ];

  if (args.avoid.length > 0) {
    lines.push(
      "",
      "คำถามที่ผู้เล่นคนนี้เพิ่งเจอไปแล้ว — ห้ามถามซ้ำหรือถามใกล้เคียง:",
      ...args.avoid.map((t) => `- ${t}`),
    );
  }

  lines.push(
    "",
    `แต่งมา ${args.count} ข้อ ตอบเป็น JSON ตามสคีมา`,
    "ฟิลด์ที่ไม่เกี่ยวกับรูปแบบนั้นให้ส่งค่าว่าง — choices เป็น [] · correctAnswer/task/rubric เป็น \"\"",
    "",
    "⚠️ ทุกข้อต้องใส่ sourceUrl และ sourceNote:",
    "- เลือกข่าว 1 ชิ้นจากรายการด้านบนที่ประเด็นของข้อนั้นโยงถึงได้",
    "- คัดลอกลิงก์จากช่อง \"ลิงก์:\" ของข่าวชิ้นนั้นมาวางใน sourceUrl ให้ตรงทุกตัวอักษร",
    "  ห้ามย่อ ห้ามตัดพารามิเตอร์ ห้ามพิมพ์ขึ้นเอง — ลิงก์ที่ไม่ตรงกับในรายการจะถูกทิ้ง",
    "- sourceNote = ชื่อสำนักข่าวของชิ้นนั้น",
    "- ผู้เล่นจะกดลิงก์นี้ไปตรวจว่าเฉลยถูกจริงไหม จึงต้องเป็นลิงก์ที่มีอยู่ในรายการเท่านั้น",
  );
  return lines.join("\n");
}

/**
 * ทุกฟิลด์เป็น required หมด แล้วให้ส่งค่าว่างสำหรับฟิลด์ที่ไม่เกี่ยวกับรูปแบบนั้น
 *
 * เพราะโหมด strict ของ OpenAI/Gemini บังคับว่าทุก property ต้องอยู่ใน required
 * ถ้าประกาศเป็น optional สคีมาจะถูกปฏิเสธ การใช้ค่าว่างจึงเป็นทางที่ทำงานได้ทุกค่าย
 */
const QUESTION_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["choice", "open", "performance"] },
          category: { type: "string", enum: CATEGORIES },
          difficulty: { type: "string", enum: DIFFICULTIES },
          prompt: { type: "string", description: "ตัวคำถาม ภาษาไทย 1-3 ประโยค" },
          choices: {
            type: "array",
            description: "ปรนัย: 4 ตัวเลือก · รูปแบบอื่น: []",
            items: { type: "string" },
          },
          correctAnswer: {
            type: "string",
            description: "ปรนัย: ต้องตรงกับตัวเลือกข้อหนึ่งเป๊ะ ๆ · รูปแบบอื่น: \"\"",
          },
          rubric: { type: "string", description: "อัตนัย/โชว์: เกณฑ์ให้คะแนน · ปรนัย: \"\"" },
          keyPoints: {
            type: "array",
            description: "อัตนัย: ประเด็นที่คำตอบดีควรมี 2-4 ข้อ · อื่น ๆ: []",
            items: { type: "string" },
          },
          task: { type: "string", description: "โชว์: สิ่งที่ต้องทำบนเวที · อื่น ๆ: \"\"" },
          explanation: { type: "string", description: "เฉลยและเหตุผล 1-2 ประโยค" },
          hints: {
            type: "object",
            properties: {
              real: { type: "array", items: { type: "string" } },
              fake: { type: "array", items: { type: "string" } },
            },
            required: ["real", "fake"],
            additionalProperties: false,
          },
          sourceNote: { type: "string", description: "ชื่อสำนักข่าวที่เอาประเด็นมา" },
          sourceUrl: {
            type: "string",
            description:
              "ลิงก์ของข่าวที่ใช้ — ต้องคัดลอกมาจากช่อง \"ลิงก์:\" ของข่าวชิ้นนั้นเป๊ะ ๆ " +
              "ห้ามพิมพ์ขึ้นเอง · ถ้าไม่ได้อิงข่าวชิ้นไหนให้ส่งค่าว่าง",
          },
          imagePrompt: {
            type: "string",
            description:
              "ข้อที่ให้หาจุดผิดจากภาพ: คำอธิบายภาพที่จะวาด ระบุข้อความไทยทุกบรรทัด " +
              "และบอกให้ชัดว่าจุดผิดอยู่ตรงไหน · ข้ออื่น ๆ: \"\"",
          },
          errorZone: {
            type: "string",
            description:
              "ข้อที่มีภาพ: จุดผิดอยู่โซนไหนของภาพ (แบ่ง 3x3) · ข้ออื่น ๆ: \"\"",
            enum: [...HINT_ZONES, ""],
          },
        },
        required: [
          "format",
          "category",
          "difficulty",
          "prompt",
          "choices",
          "correctAnswer",
          "rubric",
          "keyPoints",
          "task",
          "explanation",
          "hints",
          "sourceNote",
          "sourceUrl",
          "imagePrompt",
          "errorZone",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

interface RawQuestion {
  format?: string;
  category?: string;
  difficulty?: string;
  prompt?: string;
  choices?: string[];
  correctAnswer?: string;
  rubric?: string;
  keyPoints?: string[];
  task?: string;
  explanation?: string;
  hints?: { real?: string[]; fake?: string[] };
  sourceNote?: string;
  sourceUrl?: string;
  imagePrompt?: string;
  errorZone?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// ตัวตรวจ
// ────────────────────────────────────────────────────────────────────────────

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const cleanList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(clean).filter((s) => s.length > 0) : [];

/**
 * ทิ้งข้อที่ใช้ไม่ได้ทิ้งไปเลย ดีกว่าพยายามซ่อม
 *
 * ข้อที่เฉลยผิดหรือคำใบ้ไม่ครบทำลายเกมมากกว่าการมีคำถามน้อยลงหนึ่งข้อ
 * (ตัวเรียกขอเกินโควตาไว้แล้ว จึงมีของสำรองให้ตัดทิ้งได้)
 */
export function validateQuestion(
  raw: RawQuestion,
  stage: Stage,
  pointValue: number,
  /**
   * ลิงก์ข่าวที่ระบบดึงมาจริงในรอบนี้ → ชื่อสำนักข่าว
   *
   * ใช้เป็น allowlist ของแหล่งอ้างอิง — โมเดลแต่ง URL ที่ดูน่าเชื่อแต่ไม่มีอยู่จริง
   * ได้ง่ายมาก และแหล่งอ้างอิงปลอมอันตรายกว่าการไม่มีแหล่งอ้างอิงเลย
   * เพราะมันทำให้ข้อมูลผิดดูเหมือนตรวจสอบแล้ว
   */
  knownLinks?: Map<string, string>,
): Question | null {
  const prompt = clean(raw.prompt);
  if (prompt.length < 12) return null;

  const format = (["choice", "open", "performance"] as const).includes(
    raw.format as QuestionFormat,
  )
    ? (raw.format as QuestionFormat)
    : null;
  if (!format) return null;

  const hints = {
    real: cleanList(raw.hints?.real),
    fake: cleanList(raw.hints?.fake),
  };
  // ไม่มีคำใบ้ครบทั้งสองฝั่ง = เล่นไม่ได้ เพราะกล่องต้องมีทั้งจริงและหลอกอย่างน้อยอย่างละ 1
  if (hints.real.length < 2 || hints.fake.length < 2) return null;

  const explanation = clean(raw.explanation);
  if (!explanation) return null;

  const category = CATEGORIES.includes(raw.category as Category)
    ? (raw.category as Category)
    : "ชีวิตจริง";
  const difficulty = DIFFICULTIES.includes(raw.difficulty as Difficulty)
    ? (raw.difficulty as Difficulty)
    : "กลาง";

  // โจทย์ภาพต้องมีทั้งคำอธิบายภาพและตำแหน่งจุดผิด ขาดอย่างใดอย่างหนึ่ง
  // ก็ใช้เป็นโจทย์ภาพไม่ได้ ให้ตกเป็นคำถามข้อความธรรมดาแทน
  const imagePrompt = clean(raw.imagePrompt);
  const errorZone = (HINT_ZONES as readonly string[]).includes(clean(raw.errorZone))
    ? (clean(raw.errorZone) as HintZone)
    : undefined;
  const withImage = imagePrompt.length > 20 && errorZone ? { imagePrompt, errorZone } : {};

  // รับลิงก์เฉพาะที่อยู่ในชุดที่ดึงมาจริง ที่โมเดลพิมพ์เองทิ้งทั้งหมด
  const claimedUrl = clean(raw.sourceUrl);
  const matchedSource = claimedUrl ? knownLinks?.get(claimedUrl) : undefined;
  if (claimedUrl && !matchedSource) {
    console.warn(`[questions] ทิ้งลิงก์ที่ไม่ตรงกับข่าวที่ดึงมา: ${claimedUrl.slice(0, 120)}`);
  }
  const withSource = matchedSource
    ? { sourceUrl: claimedUrl, sourceName: matchedSource }
    : {};

  const base = {
    // id ต้องมาจากตัวคำถามล้วน ๆ ห้ามผูกกับลำดับที่โมเดลส่งมา
    // ไม่งั้นคำถามเดิมที่โผล่มาอีกรอบจะได้ id ใหม่ แล้วความจำกันซ้ำจะจับไม่ได้
    id: `live-${stage}-${fingerprintShort(prompt)}`,
    ...withImage,
    ...withSource,
    category,
    stage,
    difficulty,
    format,
    pointValue,
    prompt,
    explanation,
    hints,
  };

  if (format === "choice") {
    const choices = cleanList(raw.choices);
    const correctAnswer = clean(raw.correctAnswer);
    if (choices.length !== 4) return null;
    if (new Set(choices).size !== 4) return null;
    if (!choices.includes(correctAnswer)) return null;
    // ตัวเลือกที่ยาวกว่าเพื่อนเกินสองเท่าคือใบ้เฉลยกลาย ๆ ผู้เล่นเดาถูกโดยไม่ต้องคิด
    const lengths = choices.map((c) => c.length);
    if (Math.max(...lengths) > Math.min(...lengths) * 3) return null;
    return { ...base, choices, correctAnswer };
  }

  const rubric = clean(raw.rubric);
  if (!rubric) return null;

  if (format === "open") {
    const keyPoints = cleanList(raw.keyPoints);
    if (keyPoints.length < 2) return null;
    return { ...base, rubric, keyPoints };
  }

  const task = clean(raw.task);
  if (!task) return null;
  return { ...base, rubric, task };
}

/** id ต้องไม่ชนกันข้ามเกม เพราะ /api/hint ใช้ id หาข้อในคลังตั้งต้นก่อน */
function fingerprintShort(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

// ────────────────────────────────────────────────────────────────────────────
// แผนรูปแบบคำถามของแต่ละช่วง
// ────────────────────────────────────────────────────────────────────────────

/**
 * สัดส่วนคร่าว ๆ ต่อช่วง — ยึดจากคลังตั้งต้นที่ทีมงานเขียนไว้
 * อัตนัยเยอะกว่าปรนัยตามที่ตกลงกันไว้ และทุกช่วงต้องมีโจทย์โชว์ความสามารถอย่างน้อย 1
 */
function planFormats(stage: Stage, count: number): QuestionFormat[] {
  const performance = Math.max(1, Math.round(count * 0.2));
  const open = Math.max(1, Math.round(count * (stage === "warmup" ? 0.3 : 0.4)));
  const choice = Math.max(0, count - performance - open);
  return [
    ...Array<QuestionFormat>(choice).fill("choice"),
    ...Array<QuestionFormat>(open).fill("open"),
    ...Array<QuestionFormat>(performance).fill("performance"),
  ];
}

// ────────────────────────────────────────────────────────────────────────────
// ตัวเรียกหลัก
// ────────────────────────────────────────────────────────────────────────────

export interface StageRequest {
  stage: Stage;
  count: number;
  pointValue: number;
}

export interface GenerateOptions {
  stages: StageRequest[];
  groups: FeedGroup[];
  avoid: string[];
  /** อยากได้โจทย์ "หาจุดผิดจากภาพ" กี่ข้อต่อเกม */
  imageCount: number;
  llm?: LlmChoiceInput | null;
}

export interface GenerateResult {
  questions: Question[];
  /** ช่วงไหนสร้างได้ไม่ครบบ้าง — ตัวเรียกจะได้เติมจากคลังในเครื่อง */
  shortfall: Record<string, number>;
  sourcesUsed: string[];
  feedsFailed: string[];
  /** สาเหตุจริงที่เรียกโมเดลไม่สำเร็จ — เอาไปแสดงในหลังบ้าน */
  errors: string[];
}

/** ขอเกินโควตาไว้ เพราะ validateQuestion() ตัดทิ้งได้เสมอ */
const OVERSHOOT = 1.35;

/**
 * แต่งทีละ 4 ข้อต่อการเรียก 1 ครั้ง แล้วยิงทุกก้อนขนานกัน
 *
 * วัดจริงแล้วโมเดลใช้เวลา ~12 วิต่อคำถาม 1 ข้อ (เพราะแต่ละข้อพ่วงคำใบ้ 6 อัน)
 * ถ้าขอ 13 ข้อในครั้งเดียวจะใช้เวลาเกิน 150 วิ ทะลุเพดาน 60 วิของ Vercel ไปไกล
 * การแตกเป็นก้อนเล็กทำให้เวลารวมเท่ากับก้อนที่ช้าที่สุด (~40 วิ) ไม่ใช่ผลรวม
 *
 * ผลพลอยได้: แต่ละก้อนได้บรีฟและข่าวคนละชุด คำถามจึงกระจายกว่าการขอรวดเดียว
 */
const CHUNK_SIZE = 4;

interface Chunk {
  stage: Stage;
  pointValue: number;
  count: number;
  index: number;
}

function planChunks(stages: StageRequest[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const req of stages) {
    const ask = Math.ceil(req.count * OVERSHOOT);
    let remaining = ask;
    let index = 0;
    while (remaining > 0) {
      const size = Math.min(CHUNK_SIZE, remaining);
      chunks.push({ stage: req.stage, pointValue: req.pointValue, count: size, index });
      remaining -= size;
      index += 1;
    }
  }
  return chunks;
}

/** หมุนลิสต์ข่าวให้แต่ละก้อนเริ่มคนละจุด จะได้ไม่หยิบชิ้นเดิมไปตั้งคำถามเหมือนกัน */
function rotate<T>(list: T[], by: number): T[] {
  if (list.length === 0) return list;
  const offset = (by * 7) % list.length;
  return [...list.slice(offset), ...list.slice(0, offset)];
}

export async function generateQuestions(options: GenerateOptions): Promise<GenerateResult> {
  const choice = resolveLlm(options.llm);
  const errors: string[] = [];
  const empty: GenerateResult = {
    questions: [],
    shortfall: Object.fromEntries(options.stages.map((s) => [s.stage, s.count])),
    sourcesUsed: [],
    feedsFailed: [],
    errors,
  };
  if (!isChoiceReady(choice)) {
    errors.push(`ยังไม่มีคีย์ของ ${choice.provider} ให้ใช้ — ไปใส่ที่แท็บ API ก่อน`);
    return empty;
  }

  const totalWanted = options.stages.reduce((sum, s) => sum + s.count, 0);
  const news = await harvest(options.groups, {
    perFeed: 4,
    total: Math.max(30, totalWanted * 2),
    maxFeeds: 18,
  });
  // ไม่มีข่าวเลย = เน็ตล่มหรือฟีดตายหมด ปล่อยให้ตัวเรียกไปใช้คลังในเครื่องแทน
  if (news.items.length < 6) {
    errors.push(
      `ดึงข่าวได้แค่ ${news.items.length} ชิ้น ไม่พอจะตั้งคำถาม ` +
        `(ฟีดที่ล้ม: ${news.failed.slice(0, 3).join(", ") || "—"})`,
    );
    return { ...empty, feedsFailed: news.failed };
  }

  // ตารางลิงก์จริงของรอบนี้ ใช้กรองแหล่งอ้างอิงที่โมเดลอ้างมา
  const knownLinks = new Map(news.items.map((n) => [n.link, n.source]));

  const chunks = planChunks(options.stages);

  /**
   * กระจายโควตาโจทย์ภาพให้ทั่วทั้งเกม ทีละก้อนไม่เกิน 1 ข้อ
   *
   * ถ้าไม่กระจาย โมเดลจะกองโจทย์ภาพไว้ในก้อนเดียวจนช่วงนั้นเป็นภาพหมด
   * ส่วนช่วงอื่นไม่มีเลย — ผู้ใช้ขอไว้ว่า "สลับไปสลับมา"
   * เผื่อไว้เกินโควตาเล็กน้อยเพราะบางข้อจะโดนตัวตรวจตัดทิ้ง
   */
  const imageQuota = Math.min(options.imageCount, chunks.length);
  const imagePlan = chunks.map((_, i) => (i < imageQuota ? 1 : 0));

  const results = await Promise.all(
    chunks.map(async (chunk, chunkIndex) => {
      const formatPlan = planFormats(chunk.stage, chunk.count);
      const seeds = drawSeeds(chunk.count);
      const tasks = drawPerformanceTasks(
        formatPlan.filter((f) => f === "performance").length,
      );

      const payload = await callLlmJson<{ questions?: RawQuestion[] }>(choice, {
        system: SYSTEM,
        prompt: buildPrompt({
          stage: chunk.stage,
          count: chunk.count,
          formatPlan,
          seeds,
          tasks,
          news: rotate(news.items, chunkIndex).slice(0, 18),
          avoid: options.avoid,
          imageCount: imagePlan[chunkIndex] ?? 0,
        }),
        schema: QUESTION_SCHEMA as unknown as Record<string, unknown>,
        // คำถามพร้อมคำใบ้ 6 อันต่อข้อกินโทเคนเยอะ เผื่อไว้มากกว่างานอื่น
        maxTokens: 8_000,
        tag: `questions:${chunk.stage}#${chunk.index}`,
        errorSink: errors,
        timeoutMs: 50_000,
      });

      return { chunk, raws: payload?.questions ?? [] };
    }),
  );

  // รวมทุกก้อนแล้วค่อยตัดซ้ำทีเดียว — ก้อนต่างกันมองไม่เห็นกัน จึงแต่งชนกันได้
  const byStage = new Map<Stage, Question[]>();
  const seen = new Set<string>();
  for (const { chunk, raws } of results) {
    for (const raw of raws) {
      const q = validateQuestion(raw, chunk.stage, chunk.pointValue, knownLinks);
      if (!q) continue;
      const key = fingerprintShort(q.prompt);
      if (seen.has(key)) continue;
      seen.add(key);
      const list = byStage.get(chunk.stage) ?? [];
      list.push(q);
      byStage.set(chunk.stage, list);
    }
  }

  const questions: Question[] = [];
  const shortfall: Record<string, number> = {};
  for (const req of options.stages) {
    const got = (byStage.get(req.stage) ?? []).slice(0, req.count);
    questions.push(...got);
    if (got.length < req.count) shortfall[req.stage] = req.count - got.length;
  }

  /**
   * ด่านสุดท้ายของแหล่งอ้างอิง — ยิงจริงดูว่าเปิดได้ไหม
   *
   * ผ่าน knownLinks มาแล้วแปลว่า "โมเดลไม่ได้แต่ง URL ขึ้นเอง" เท่านั้น
   * ยังไม่ได้แปลว่าลิงก์นั้นเปิดได้ — ฟีดเองก็ให้ลิงก์เสียมาได้ (เจอกับ FTC มาแล้ว)
   * ตรงนี้จึงตัดทิ้งทุกตัวที่ยืนยันไม่ได้ ยอมให้บางข้อไม่มีแหล่งอ้างอิง
   * ดีกว่าโชว์ลิงก์ที่กดแล้วเจอ 404 หรือหน้าเปล่า
   */
  const cited = questions
    .map((q) => q.sourceUrl)
    .filter((url): url is string => Boolean(url));
  if (cited.length > 0) {
    const working = await verifyLinks(cited);
    for (const q of questions) {
      if (q.sourceUrl && !working.has(q.sourceUrl)) {
        delete q.sourceUrl;
        delete q.sourceName;
      }
    }
  }

  return {
    questions,
    shortfall,
    sourcesUsed: news.ok,
    feedsFailed: news.failed,
    // ตัดให้เหลือไม่กี่บรรทัด — ทุกก้อนที่พังมักพังด้วยเหตุผลเดียวกัน
    errors: [...new Set(errors)].slice(0, 3),
  };
}
