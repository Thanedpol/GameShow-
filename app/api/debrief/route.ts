import { NextResponse, type NextRequest } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { getQuestionById } from "@/lib/questions";
import { HINT_MODEL, getAnthropic, openReveal, parseJsonLoose } from "@/lib/hintEngine";
import type { DebriefApiRequest, DebriefApiResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface EnrichedItem {
  index: number;
  questionId: string;
  prompt: string;
  boxLabel: string;
  text: string;
  truth: string;
  rationale: string;
  wasCorrect: boolean;
}

const DEBRIEF_SYSTEM = `
คุณคือโปรดิวเซอร์ของเกมโชว์ไทย "ใบ้จริง...ใบ้หลอก"
หน้าที่: เขียนสรุปช่วง Debrief หลังจบเกม อธิบายว่ากล่องคำใบ้แต่ละกล่องที่ผู้เล่นเปิด
ถูกออกแบบมาแบบนั้นเพราะอะไร และผู้เล่นจะจับสังเกตได้อย่างไรถ้าเจออีก

แนวทาง:
- ภาษาไทย เป็นกันเอง ให้กำลังใจ แต่ตรงประเด็น
- แต่ละกล่องเขียน 1-2 ประโยค บอกชัดว่าส่วนไหนเป็นเบาะแสจริง ส่วนไหนใส่มาเพื่อลวง
- กล่องที่มีส่วนหลอก ให้ย้ำสั้น ๆ ว่าส่วนนั้นแต่งขึ้นเพื่อเกม ห้ามนำไปอ้างอิงจริง
- ช่อง overall สรุปภาพรวม 2-4 ประโยค เน้นบทเรียนเรื่องการตรวจสอบข้อมูลก่อนเชื่อ
- ห้ามแต่งข้อมูลใหม่นอกเหนือจากที่ได้รับ
`.trim();

const DEBRIEF_SCHEMA = {
  type: "object",
  properties: {
    overall: { type: "string", description: "สรุปภาพรวม ภาษาไทย 2-4 ประโยค" },
    notes: {
      type: "array",
      description: "คำอธิบายรายกล่อง เรียงตาม index ที่ได้รับ",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          text: { type: "string", description: "คำอธิบายภาษาไทย 1-2 ประโยค" },
        },
        required: ["index", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["overall", "notes"],
  additionalProperties: false,
} as const;

function fallbackNote(item: EnrichedItem): string {
  const base =
    item.truth === "จริง"
      ? "กล่องนี้เป็นเบาะแสจริงล้วน ชี้เข้าหาคำตอบโดยไม่เฉลยตรง ๆ"
      : "กล่องนี้ตั้งใจผสมเบาะแสจริง 1 อย่างกับเบาะแสที่แต่งขึ้น 1 อย่าง " +
        "เพื่อทดสอบว่าผู้เล่นจะแยกออกหรือไม่ ส่วนที่แต่งขึ้นห้ามนำไปอ้างอิงจริง";
  return `${base} (เหตุผลจากตอนสร้าง: ${item.rationale})`;
}

function fallbackOverall(body: DebriefApiRequest): string {
  const list = (body.participants ?? [])
    .map((p) => `${p.name} ${p.score} คะแนน`)
    .join(" · ");
  return (
    `ผลรวม: ${list || "—"} ` +
    "บทเรียนสำคัญของเกมนี้คือ คำใบ้ที่ฟังดูน่าเชื่อไม่ได้แปลว่าจริงเสมอไป " +
    "ก่อนเชื่ออะไรควรถามว่าแหล่งข้อมูลนั้นตรวจสอบได้จริงไหม"
  );
}

export async function POST(request: NextRequest) {
  let body: DebriefApiRequest;
  try {
    body = (await request.json()) as DebriefApiRequest;
  } catch {
    return NextResponse.json({ error: "รูปแบบ JSON ไม่ถูกต้อง" }, { status: 400 });
  }

  const history = Array.isArray(body.hintHistory) ? body.hintHistory : [];

  const items: EnrichedItem[] = history.map((h, index) => {
    const question = getQuestionById(h.questionId);
    const record = h.revealToken ? openReveal(h.revealToken) : null;
    const box = record?.boxes.find((b) => b.id === h.boxId);
    return {
      index,
      questionId: h.questionId,
      prompt: question?.prompt ?? h.questionId,
      boxLabel: h.boxLabel,
      text: h.text,
      truth: box?.truth ?? "ไม่ทราบ",
      rationale: box?.rationale ?? "ไม่พบบันทึกเหตุผล (token หมดอายุหรือคีย์เปลี่ยน)",
      wasCorrect: h.wasCorrect,
    };
  });

  const buildResponse = (
    overall: string,
    noteText: (item: EnrichedItem) => string,
    source: "claude" | "fallback",
  ): DebriefApiResponse => ({
    overall,
    source,
    notes: items.map((item) => ({
      index: item.index,
      questionId: item.questionId,
      boxLabel: item.boxLabel,
      truth: item.truth,
      text: item.text,
      wasCorrect: item.wasCorrect,
      note: noteText(item),
    })),
  });

  const client = getAnthropic();
  if (!client || items.length === 0) {
    return NextResponse.json(
      buildResponse(fallbackOverall(body), fallbackNote, "fallback"),
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const userPrompt = [
    "ผลคะแนน: " +
      (body.participants ?? []).map((p) => `${p.name} ${p.score}`).join(" · "),
    "",
    `กล่องคำใบ้ที่ถูกเปิดทั้งหมด ${items.length} กล่อง:`,
    ...items.map((item) =>
      [
        `[index ${item.index}] กล่อง ${item.boxLabel}`,
        `คำถาม: ${item.prompt}`,
        `สถานะจริง/หลอก (ข้อมูลภายใน): ${item.truth}`,
        `ข้อความในกล่อง: ${item.text}`,
        `เหตุผลการออกแบบตอนสร้าง: ${item.rationale}`,
        `ผลลัพธ์: ผู้เล่นตอบ${item.wasCorrect ? "ถูก" : "ผิด/ไม่ได้คะแนนเต็ม"}`,
      ].join("\n"),
    ),
    "",
    `เขียน notes ให้ครบทั้ง ${items.length} รายการ โดยใช้ index ตรงตามที่ระบุ`,
  ].join("\n");

  try {
    const message = await client.messages.create(
      {
        model: HINT_MODEL,
        max_tokens: 16000,
        system: DEBRIEF_SYSTEM,
        messages: [{ role: "user", content: userPrompt }],
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: DEBRIEF_SCHEMA },
        },
      },
      { timeout: 45_000 },
    );

    if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") {
      console.warn(`[/api/debrief] ใช้ข้อความสำรอง (stop_reason=${message.stop_reason})`);
      return NextResponse.json(
        buildResponse(fallbackOverall(body), fallbackNote, "fallback"),
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const raw = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const parsed = parseJsonLoose<{
      overall?: string;
      notes?: Array<{ index?: number; text?: string }>;
    }>(raw);

    if (!parsed?.overall) {
      return NextResponse.json(
        buildResponse(fallbackOverall(body), fallbackNote, "fallback"),
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const byIndex = new Map<number, string>();
    for (const note of parsed.notes ?? []) {
      if (typeof note.index === "number" && typeof note.text === "string") {
        byIndex.set(note.index, note.text);
      }
    }

    return NextResponse.json(
      buildResponse(
        parsed.overall,
        (item) => byIndex.get(item.index) ?? fallbackNote(item),
        "claude",
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[/api/debrief] สรุปผลไม่สำเร็จ:", error);
    return NextResponse.json(
      buildResponse(fallbackOverall(body), fallbackNote, "fallback"),
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
