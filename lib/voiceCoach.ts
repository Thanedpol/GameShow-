import "server-only";

import { providerKey, resolveLlm, type LlmChoiceInput } from "./llm";

/**
 * โค้ชเสียง — ฟังคลิปที่ผู้เล่นแสดงสด แล้วให้ฟีดแบ็กแบบผู้เชี่ยวชาญ
 *
 * ตั้งใจ "ไม่ให้คะแนน" — คนยังเป็นคนกดดาวเหมือนเดิม
 * เพราะการตัดสินการแสดงเป็นเรื่องรสนิยมและบรรยากาศหน้างาน ซึ่ง AI ไม่ได้อยู่ตรงนั้น
 * สิ่งที่ AI ทำได้ดีกว่าคนดูทั่วไปคือชี้จุดเทคนิคที่หูคนธรรมดาจับไม่ทัน
 * เช่น เพี้ยนช่วงไหน จังหวะรวบตรงไหน ลมหายใจขาดที่ประโยคใด
 *
 * ⚠️ ใช้ได้เฉพาะ Gemini เท่านั้น
 * ต้องเรียก endpoint ดั้งเดิมของ Google ไม่ใช่ทาง OpenAI-compatible ที่ lib/llm.ts
 * ใช้อยู่ เพราะรูปแบบ chat completions รับไฟล์เสียงได้จำกัดกว่ามาก
 * ส่วน Claude กับ Ollama ไม่รับไฟล์เสียงเลย — เจอกรณีนั้นจะข้ามฟีดแบ็กไปเงียบ ๆ
 * แล้วเกมก็ยังให้ดาวได้ตามปกติ
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** ทดสอบแล้วว่า Gemini รับได้ทั้งสามแบบ ครอบคลุมทุกเบราว์เซอร์หลัก */
const ALLOWED_MIME = new Set([
  "audio/webm", // Chrome / Edge
  "audio/ogg", // Firefox
  "audio/mp4", // Safari
  "audio/mpeg",
  "audio/wav",
  "audio/aac",
  "audio/flac",
]);

/** เพดานขนาดไฟล์ — 60 วินาทีของ opus อยู่ราว 500KB เผื่อไว้เป็น 6MB */
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;

const SYSTEM = `
คุณคือโค้ชด้านการใช้เสียงและการแสดงสด ที่เชี่ยวชาญทั้งเพลงไทย
(ลูกทุ่ง ลูกกรุง สตริง เพื่อชีวิต) และเพลงสากลหลากหลายแนว
รวมถึงการพูดบนเวที การเล่าเรื่อง และการนำเสนอ

หน้าที่: ฟังคลิปที่ผู้เล่นเพิ่งแสดงสด แล้วให้ฟีดแบ็กที่เอาไปฝึกต่อได้จริง

หลักการให้ฟีดแบ็ก:
- พูดถึงสิ่งที่ "ได้ยินจริง" ในคลิปเท่านั้น ห้ามเดาหรือแต่งเติมสิ่งที่ไม่ได้ยิน
- ถ้าเสียงเบา ฟังไม่ชัด หรือคลิปแทบไม่มีเสียงคน ให้บอกตรง ๆ ว่าประเมินไม่ได้
  อย่าแกล้งวิจารณ์สิ่งที่ไม่ได้ยิน
- ชมให้ตรงจุดก่อน แล้วค่อยบอกสิ่งที่ปรับได้ อย่างละไม่เกิน 2 ข้อ
- ใช้ภาษาพูดคุยเป็นกันเอง เหมือนโค้ชกระซิบข้างเวที ไม่ใช่ภาษาตำรา
- ถ้าเป็นการร้องเพลง ให้แตะเรื่องคีย์ จังหวะ ลมหายใจ และการตีความอารมณ์
- ถ้าเป็นการพูดหรือเล่าเรื่อง ให้แตะเรื่องจังหวะการหยุด น้ำหนักคำ และความชัดของเสียง
- ห้ามให้คะแนนเป็นตัวเลข และห้ามบอกว่าควรได้กี่ดาว — คนดูเป็นคนตัดสินเอง

ตอบเป็นภาษาไทยทั้งหมด
`.trim();

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    audible: {
      type: "boolean",
      description: "ได้ยินเสียงผู้แสดงชัดพอจะประเมินไหม",
    },
    summary: {
      type: "string",
      description: "สรุปภาพรวมสั้น ๆ 1-2 ประโยค ภาษาพูด",
    },
    strengths: {
      type: "array",
      description: "สิ่งที่ทำได้ดี 1-2 ข้อ ชี้ให้ตรงจุด",
      items: { type: "string" },
    },
    improvements: {
      type: "array",
      description: "สิ่งที่ปรับได้ 1-2 ข้อ บอกวิธีฝึกด้วย",
      items: { type: "string" },
    },
    technique: {
      type: "string",
      description: "ข้อสังเกตเชิงเทคนิคที่หูคนทั่วไปมักจับไม่ทัน 1 ประโยค",
    },
  },
  required: ["audible", "summary", "strengths", "improvements", "technique"],
} as const;

export interface VoiceCritique {
  audible: boolean;
  summary: string;
  strengths: string[];
  improvements: string[];
  technique: string;
}

export interface CritiqueInput {
  audioBase64: string;
  mimeType: string;
  /** โจทย์ที่ผู้เล่นได้รับ ใช้บอกโค้ชว่ากำลังฟังอะไรอยู่ */
  task: string;
  rubric?: string;
  llm?: LlmChoiceInput | null;
}

export type CritiqueOutcome =
  | { ok: true; critique: VoiceCritique }
  | { ok: false; reason: string };

export function isSupportedAudioType(mimeType: string): boolean {
  // เบราว์เซอร์ชอบต่อท้ายด้วย codecs=... จึงต้องตัดออกก่อนเทียบ
  return ALLOWED_MIME.has(mimeType.split(";")[0].trim().toLowerCase());
}

export async function critiquePerformance(input: CritiqueInput): Promise<CritiqueOutcome> {
  const choice = resolveLlm(input.llm);
  if (choice.provider !== "gemini") {
    return {
      ok: false,
      reason:
        `ฟีดแบ็กเสียงใช้ได้เฉพาะ Gemini — ตอนนี้ตั้งไว้เป็น ${choice.provider} ` +
        `ให้ไปเลือก Gemini ที่หลังบ้าน แท็บ API`,
    };
  }
  if (!isSupportedAudioType(input.mimeType)) {
    return { ok: false, reason: `ไม่รองรับไฟล์เสียงชนิด ${input.mimeType}` };
  }

  const key = providerKey("gemini", choice.apiKey);
  if (!key) return { ok: false, reason: "ยังไม่มีคีย์ Gemini" };

  const bytes = Math.ceil((input.audioBase64.length * 3) / 4);
  if (bytes > MAX_AUDIO_BYTES) {
    return { ok: false, reason: `คลิปใหญ่เกินไป (${Math.round(bytes / 1024)}KB)` };
  }

  const prompt = [
    "โจทย์ที่ผู้เล่นได้รับ:",
    input.task,
    input.rubric ? `\nเกณฑ์ที่กรรมการใช้: ${input.rubric}` : "",
    "",
    "ฟังคลิปแล้วให้ฟีดแบ็กตามสคีมา",
  ]
    .filter(Boolean)
    .join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(`${GEMINI_BASE}/${choice.model}:generateContent`, {
      method: "POST",
      signal: controller.signal,
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [
          {
            parts: [
              { text: prompt },
              { inlineData: { mimeType: input.mimeType.split(";")[0], data: input.audioBase64 } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });

    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}: ${body.error?.message ?? "ไม่ทราบสาเหตุ"}` };
    }

    const text = body.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
    if (!text) return { ok: false, reason: "โมเดลไม่ได้ตอบอะไรกลับมา" };

    const parsed = JSON.parse(text) as Partial<VoiceCritique>;
    return {
      ok: true,
      critique: {
        audible: parsed.audible !== false,
        summary: String(parsed.summary ?? "").trim(),
        strengths: (parsed.strengths ?? []).filter((s) => typeof s === "string" && s.trim()),
        improvements: (parsed.improvements ?? []).filter(
          (s) => typeof s === "string" && s.trim(),
        ),
        technique: String(parsed.technique ?? "").trim(),
      },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[voiceCoach] ฟังคลิปไม่สำเร็จ:", detail);
    return { ok: false, reason: detail === "The operation was aborted." ? "หมดเวลารอ" : detail };
  } finally {
    clearTimeout(timer);
  }
}
