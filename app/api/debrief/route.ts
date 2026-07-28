import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getQuestionById } from "@/lib/questions";
import { HINT_MODEL, getAnthropic, getReveal, parseJsonLoose } from "@/lib/hintEngine";
import type { DebriefApiRequest, DebriefApiResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EnrichedItem {
  index: number;
  questionId: string;
  prompt: string;
  correctAnswer: string;
  player: 1 | 2;
  hintType: string;
  hintText: string;
  wasCorrect: boolean;
  truth: string;
  rationale: string;
  fromFinalDuel: boolean;
}

const DEBRIEF_SYSTEM = `
คุณคือโปรดิวเซอร์ของเกมโชว์ภาษาไทย "ใบ้จริง...ใบ้หลอก"
หน้าที่ตอนนี้: เขียนสรุปช่วง Debrief หลังจบเกม เพื่ออธิบายให้ผู้เล่นเข้าใจว่า
"คำใบ้แต่ละข้อที่เคยขอไป ถูกออกแบบมาแบบนั้นเพราะอะไร"

แนวทาง:
- ภาษาไทย เป็นกันเอง ให้กำลังใจ แต่ตรงประเด็น
- แต่ละคำใบ้เขียน 1-2 ประโยค บอกให้ชัดว่าส่วนไหนเป็นเบาะแสจริง ส่วนไหนถูกใส่มาเพื่อลวง
  และผู้เล่นจะจับสังเกตได้อย่างไรถ้าเจอแบบนี้อีก
- สำหรับคำใบ้ที่มีส่วนหลอก ให้ย้ำสั้น ๆ ว่าส่วนที่หลอกนั้นเป็นเรื่องแต่งขึ้นเพื่อเกม
  ห้ามนำไปอ้างอิงจริง
- ช่อง overall เขียนสรุปภาพรวมทั้งเกม 2-4 ประโยค พูดถึงบทเรียนเรื่องการตรวจสอบข้อมูล
- ห้ามแต่งข้อมูลใหม่นอกเหนือจากที่ได้รับมา
`.trim();

const DEBRIEF_SCHEMA = {
  type: "object",
  properties: {
    overall: { type: "string", description: "สรุปภาพรวมทั้งเกม ภาษาไทย 2-4 ประโยค" },
    notes: {
      type: "array",
      description: "คำอธิบายรายคำใบ้ เรียงตาม index ที่ได้รับมา",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "index ของคำใบ้ตามที่ส่งมา" },
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
      ? "คำใบ้ชุดนี้ถูกออกแบบให้เป็นเบาะแสจริงล้วน ชี้เข้าหาคำตอบโดยไม่เฉลยตรง ๆ"
      : "คำใบ้ชุดนี้ตั้งใจผสมเบาะแสจริง 1 อย่างกับเบาะแสที่แต่งขึ้น 1 อย่าง " +
        "เพื่อทดสอบว่าผู้เล่นจะแยกออกหรือไม่ ส่วนที่แต่งขึ้นห้ามนำไปอ้างอิงจริง";
  return `${base} (เหตุผลจากตอนสร้าง: ${item.rationale})`;
}

function fallbackOverall(body: DebriefApiRequest): string {
  const winner =
    body.player1Score === body.player2Score
      ? "เสมอกัน"
      : body.player1Score > body.player2Score
        ? body.player1Name
        : body.player2Name;
  return (
    `จบเกมด้วยผล ${body.player1Name} ${body.player1Score} คะแนน และ ` +
    `${body.player2Name} ${body.player2Score} คะแนน (${winner}) ` +
    "บทเรียนสำคัญของเกมนี้คือ คำใบ้ที่ฟังดูน่าเชื่อไม่ได้แปลว่าจริงเสมอไป " +
    "ก่อนเชื่อควรถามว่าแหล่งข้อมูลนั้นตรวจสอบได้ไหม"
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

  // เติม label จริง/หลอก + เหตุผลการออกแบบจาก store ฝั่งเซิร์ฟเวอร์
  const items: EnrichedItem[] = history.map((h, index) => {
    const question = getQuestionById(h.questionId);
    const record = h.revealId ? getReveal(h.revealId) : undefined;
    const hint = record?.hints.find((x) => x.id === h.hintId);
    return {
      index,
      questionId: h.questionId,
      prompt: question?.prompt ?? h.questionId,
      correctAnswer: question?.correctAnswer ?? "(ไม่ทราบ)",
      player: h.player,
      hintType: h.hintType,
      hintText: h.aiGeneratedText,
      wasCorrect: h.wasCorrect,
      truth: hint?.truth ?? (h.hintType === "ตรง" ? "จริง" : "หลอก"),
      rationale: hint?.rationale ?? "ไม่พบบันทึกเหตุผล (เซิร์ฟเวอร์อาจรีสตาร์ท)",
      fromFinalDuel: h.fromFinalDuel === true,
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
      hintType: item.hintType,
      truth: item.truth,
      hintText: item.hintText,
      wasCorrect: item.wasCorrect,
      text: noteText(item),
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
    `ผู้เล่น 1: ${body.player1Name} — ${body.player1Score} คะแนน`,
    `ผู้เล่น 2: ${body.player2Name} — ${body.player2Score} คะแนน`,
    "",
    `รายการคำใบ้ที่ถูกขอไปทั้งหมด ${items.length} ชุด:`,
    ...items.map((item) =>
      [
        `[index ${item.index}]`,
        `คำถาม: ${item.prompt}`,
        `คำตอบที่ถูก: ${item.correctAnswer}`,
        `ผู้ขอคำใบ้: ผู้เล่น ${item.player}`,
        item.fromFinalDuel
          ? "ที่มา: รอบ AI Duel Final — ระบบแจกคำใบ้ 3 ชุด (จริง 1 หลอก 2) พร้อมกัน " +
            "ผู้เล่นไม่ได้เลือกโหมดเอง แต่เลือกว่าจะ 'เชื่อ' ชุดนี้"
          : `โหมดที่ผู้เล่นเลือกขอ: ใบ้${item.hintType}`,
        `สถานะจริง/หลอกของคำใบ้ (ข้อมูลภายใน): ${item.truth}`,
        `ข้อความคำใบ้: ${item.hintText}`,
        `เหตุผลการออกแบบตอนสร้าง: ${item.rationale}`,
        `ผลลัพธ์: ผู้เล่นตอบ${item.wasCorrect ? "ถูก" : "ผิด"}`,
      ].join("\n"),
    ),
    "",
    `เขียน notes ให้ครบทั้ง ${items.length} รายการ โดยใช้ index ตรงตามที่ระบุไว้ข้างบน`,
  ].join("\n");

  try {
    const message = await client.messages.create(
      {
        model: HINT_MODEL,
        // เผื่อพื้นที่ให้ thinking token (max_tokens นับรวม thinking + ข้อความตอบกลับ)
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
      console.warn(
        `[/api/debrief] ใช้ข้อความสำรอง (stop_reason=${message.stop_reason})`,
        message.stop_details,
      );
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
    if (error instanceof Anthropic.APIError) {
      console.error(`[/api/debrief] Anthropic API error ${error.status}:`, error.message);
    } else {
      console.error("[/api/debrief] สรุปผลไม่สำเร็จ:", error);
    }
    return NextResponse.json(
      buildResponse(fallbackOverall(body), fallbackNote, "fallback"),
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
