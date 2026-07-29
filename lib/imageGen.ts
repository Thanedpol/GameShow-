import "server-only";

import { providerKey, resolveLlm, type LlmChoiceInput } from "./llm";

/**
 * วาดภาพโจทย์ "หาจุดผิด"
 *
 * ⚠️ สองเรื่องที่วัดมาแล้วและเป็นตัวกำหนดรูปร่างของไฟล์นี้:
 *
 * 1) Gemini "ปฏิเสธ" การวาดของปลอมที่ดูสมจริง — ลองสั่งวาดหน้าจอ SMS ปลอม
 *    ของธนาคารแล้วโดนปฏิเสธตรง ๆ ว่าอาจถูกเอาไปใช้หลอกคนจริง ซึ่งถูกต้องแล้ว
 *    โจทย์แนวสแกมจึงต้องเลี่ยงไปใช้ "ของที่ผิดโดยไม่ใช่ของปลอม" แทน เช่น
 *    ตารางที่บวกเลขไม่ตรง ป้ายที่เขียนขั้นตอนสลับลำดับ กราฟที่แกนบิดเบือน
 *
 * 2) ภาษาไทยในภาพออกมาคมชัดและสะกดถูก (ทดสอบกับ gemini-3.1-flash-lite-image)
 *    จึงใช้ภาพที่มีตัวหนังสือเป็นโจทย์ได้จริง ไม่ต้องเลี่ยงไปวาดแต่ภาพเปล่า
 *
 * เลือก flash-lite-image เป็นค่าตั้งต้นเพราะวัดแล้วเร็วกว่าตัวเต็มราว 2.5 เท่า
 * (4.6 วิ เทียบกับ 11.6 วิ) โดยคุณภาพตัวหนังสือไทยไม่ต่างกันเลย
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-lite-image";

/** วาดพร้อมกันได้ไม่เกินนี้ กันยิงทีเดียว 7 ภาพแล้วโดน rate limit */
const MAX_PARALLEL = 4;
const TIMEOUT_MS = 30_000;

const STYLE_GUIDE = `
ข้อกำหนดของภาพ (สำคัญมาก):
- เป็นภาพกราฟิกเรียบง่าย อ่านง่าย โทนสีฟ้า-คราม-ขาว เข้ากับธีมเกม
- ตัวหนังสือทั้งหมดต้องเป็นภาษาไทย สะกดถูก คมชัด อ่านออกทุกตัว
- ใส่ข้อความเฉพาะบรรทัดที่ระบุไว้เท่านั้น ห้ามเติมหัวตาราง ป้ายกำกับ
  หรือข้อความประดับอื่นขึ้นมาเอง — ตัวหนังสือเล็ก ๆ ที่ไม่ได้สั่งมักออกมาเพี้ยน
- ตัวอักษรทุกตัวต้องใหญ่พอที่จะอ่านออกบนจอมือถือ
- ห้ามใส่เฉลยหรือคำว่า "ผิด" "ถูก" ลงในภาพ
- ห้ามวาดสิ่งที่เลียนแบบเอกสารจริง โลโก้จริง หรือหน้าจอแอปของธนาคาร/หน่วยงานจริง
- ไม่มีคน ไม่มีใบหน้า
`.trim();

export interface ImageJob {
  /** ผูกกลับไปที่คำถาม */
  id: string;
  /** คำอธิบายภาพที่โมเดลแต่งคำถามเขียนไว้ */
  prompt: string;
}

export interface ImageResult {
  id: string;
  /** data URI พร้อมใส่ใน <img src> — null คือวาดไม่สำเร็จ */
  dataUrl: string | null;
  reason?: string;
}

async function drawOne(
  job: ImageJob,
  model: string,
  key: string,
): Promise<ImageResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
      method: "POST",
      signal: controller.signal,
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${job.prompt}\n\n${STYLE_GUIDE}` }] }],
      }),
    });

    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> } }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      return { id: job.id, dataUrl: null, reason: `HTTP ${res.status}: ${body.error?.message ?? ""}` };
    }

    const parts = body.candidates?.[0]?.content?.parts ?? [];
    const image = parts.find((p) => p.inlineData)?.inlineData;
    if (!image) {
      // โมเดลตอบเป็นข้อความแทนภาพ = มันปฏิเสธที่จะวาด เก็บเหตุผลไว้ดู
      const said = parts.find((p) => p.text)?.text ?? "";
      return { id: job.id, dataUrl: null, reason: said.slice(0, 160) || "ไม่มีภาพกลับมา" };
    }
    return { id: job.id, dataUrl: `data:${image.mimeType};base64,${image.data}` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { id: job.id, dataUrl: null, reason: detail };
  } finally {
    clearTimeout(timer);
  }
}

export interface DrawOptions {
  jobs: ImageJob[];
  llm?: LlmChoiceInput | null;
}

export interface DrawOutcome {
  images: ImageResult[];
  /** เหตุผลที่ทำไม่ได้ทั้งชุด — ว่างแปลว่าอย่างน้อยลองวาดแล้ว */
  blocked?: string;
}

export async function drawQuestionImages(options: DrawOptions): Promise<DrawOutcome> {
  const choice = resolveLlm(options.llm);
  if (choice.provider !== "gemini") {
    return { images: [], blocked: `สร้างภาพได้เฉพาะ Gemini — ตอนนี้ตั้งไว้เป็น ${choice.provider}` };
  }
  const key = providerKey("gemini", choice.apiKey);
  if (!key) return { images: [], blocked: "ยังไม่มีคีย์ Gemini" };

  // โมเดลข้อความวาดภาพไม่ได้ ถ้าไม่ได้ตั้งโมเดลภาพไว้ก็ใช้ตัวที่รู้ว่าใช้ได้
  const model = /image/.test(choice.model) ? choice.model : DEFAULT_IMAGE_MODEL;

  const images: ImageResult[] = [];
  for (let i = 0; i < options.jobs.length; i += MAX_PARALLEL) {
    const batch = options.jobs.slice(i, i + MAX_PARALLEL);
    images.push(...(await Promise.all(batch.map((job) => drawOne(job, model, key)))));
  }
  return { images };
}
