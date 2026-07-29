import "server-only";

import { providerKey, resolveLlm, type LlmChoiceInput } from "./llm";

/**
 * ถอดเสียงพูดเป็นข้อความไทย — ทางสำรองของปุ่มไมค์
 *
 * ทางหลักคือ Web Speech API ในเบราว์เซอร์ ซึ่งฟรีและขึ้นข้อความสด ๆ ระหว่างพูด
 * แต่มีเฉพาะ Chrome/Edge ไฟล์นี้จึงมีไว้รับเบราว์เซอร์ที่เหลือ (Safari/Firefox)
 * โดยยอมแลกว่าต้องพูดจบก่อนแล้วรออีก 3-5 วินาที
 *
 * ใช้ endpoint ดั้งเดิมของ Google เหมือน voiceCoach.ts ด้วยเหตุผลเดียวกัน —
 * ทาง OpenAI-compatible รับไฟล์เสียงได้จำกัดกว่ามาก
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 30_000;
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/aac",
  "audio/flac",
]);

const SYSTEM = `
คุณคือเครื่องถอดเสียงพูดเป็นข้อความ

กติกา:
- ถอดสิ่งที่ได้ยินออกมาเป็นข้อความภาษาไทยตามที่พูดจริง
- ห้ามสรุป ห้ามตีความ ห้ามเติมเนื้อหาที่ไม่ได้พูด ห้ามตอบคำถามที่ได้ยิน
- เขียนแบบภาษาไทยปกติ — คำในประโยคเดียวกันต้องติดกัน ห้ามเว้นวรรคระหว่างทุกคำ
  ผิด: "ผม คิด ว่า ควร เปิด ด้วย ปัญหา"
  ถูก: "ผมคิดว่าควรเปิดด้วยปัญหา"
- เว้นวรรคเฉพาะที่คนไทยเว้นจริง คือคั่นระหว่างวลีหรือประโยค
- ตัดคำติดปากที่ไม่มีความหมายออกได้ เช่น เอ่อ อืม
- ถ้าไม่ได้ยินเสียงพูดเลย ให้ตอบข้อความว่างเปล่า
`.trim();

export interface TranscribeInput {
  audioBase64: string;
  mimeType: string;
  llm?: LlmChoiceInput | null;
}

export type TranscribeOutcome =
  | { ok: true; text: string }
  | { ok: false; reason: string };

export function isSupportedAudioType(mimeType: string): boolean {
  return ALLOWED_MIME.has(mimeType.split(";")[0].trim().toLowerCase());
}

export async function transcribeAudio(input: TranscribeInput): Promise<TranscribeOutcome> {
  const choice = resolveLlm(input.llm);
  if (choice.provider !== "gemini") {
    return { ok: false, reason: `ถอดเสียงได้เฉพาะ Gemini — ตอนนี้ตั้งไว้เป็น ${choice.provider}` };
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
              { text: "ถอดเสียงในคลิปนี้เป็นข้อความ" },
              { inlineData: { mimeType: input.mimeType.split(";")[0], data: input.audioBase64 } },
            ],
          },
        ],
        // ปิดการคิดก่อนตอบ งานถอดเสียงไม่ต้องใช้ และทำให้ตอบไวขึ้นชัดเจน
        generationConfig: { temperature: 0, maxOutputTokens: 2048 },
      }),
    });

    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}: ${body.error?.message ?? "ไม่ทราบสาเหตุ"}` };
    }

    const text = body.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? "";
    return { ok: true, text: text.trim() };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[transcribe] ถอดเสียงไม่สำเร็จ:", detail);
    return { ok: false, reason: detail === "The operation was aborted." ? "หมดเวลารอ" : detail };
  } finally {
    clearTimeout(timer);
  }
}
