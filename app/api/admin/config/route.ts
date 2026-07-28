import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { HINT_MODEL } from "@/lib/hintEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ENV_FILE = ".env.local";
const IS_PROD = process.env.NODE_ENV === "production";

/**
 * หลังบ้าน — แท็บ API
 *
 * ข้อจำกัดที่ตั้งใจ:
 * - ไม่เคยส่งคีย์เต็มกลับไปฝั่ง client (มาสก์เสมอ)
 * - เขียน .env.local ได้เฉพาะตอนรัน dev ในเครื่อง เพราะบน Vercel ระบบไฟล์
 *   เป็น read-only และการเปิดให้เขียน env ผ่านเว็บสาธารณะคือช่องโหว่
 * - ถ้าตั้ง ADMIN_PASSWORD ไว้ ต้องส่ง header x-admin-password ให้ตรงก่อนถึงจะแก้ได้
 */

function maskKey(key: string): string {
  if (key.length <= 12) return "•".repeat(key.length);
  return `${key.slice(0, 7)}${"•".repeat(12)}${key.slice(-4)}`;
}

function authorized(request: NextRequest): boolean {
  const expected = process.env.ADMIN_PASSWORD?.trim();
  if (!expected) return true;
  return request.headers.get("x-admin-password") === expected;
}

export interface AdminConfigResponse {
  hasKey: boolean;
  maskedKey: string | null;
  model: string;
  /** แก้คีย์ผ่านหน้าเว็บได้ไหม (dev เท่านั้น) */
  writable: boolean;
  /** ต้องใส่รหัสผ่านหรือไม่ */
  passwordRequired: boolean;
  environment: string;
  hasRevealSecret: boolean;
}

export async function GET(request: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  const payload: AdminConfigResponse = {
    hasKey: Boolean(key),
    maskedKey: key ? maskKey(key) : null,
    model: HINT_MODEL,
    writable: !IS_PROD,
    passwordRequired: Boolean(process.env.ADMIN_PASSWORD?.trim()),
    environment: IS_PROD ? "production" : "development",
    hasRevealSecret: Boolean(process.env.REVEAL_SECRET?.trim()),
  };

  if (payload.passwordRequired && !authorized(request)) {
    return NextResponse.json(
      { ...payload, hasKey: false, maskedKey: null, locked: true },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}

/** อัปเดตค่าเดิมใน .env.local โดยไม่ทับบรรทัดอื่น */
function upsertEnv(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(content)) return content.replace(pattern, line);
  return content.trimEnd() ? `${content.trimEnd()}\n${line}\n` : `${line}\n`;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "รหัสผ่านหลังบ้านไม่ถูกต้อง" }, { status: 401 });
  }
  if (IS_PROD) {
    return NextResponse.json(
      {
        error:
          "บน production แก้คีย์ผ่านหน้าเว็บไม่ได้ (ระบบไฟล์เป็น read-only) " +
          "ให้ไปตั้งที่ Vercel → Settings → Environment Variables แล้ว redeploy",
      },
      { status: 403 },
    );
  }

  let body: { apiKey?: string; model?: string };
  try {
    body = (await request.json()) as { apiKey?: string; model?: string };
  } catch {
    return NextResponse.json({ error: "รูปแบบ JSON ไม่ถูกต้อง" }, { status: 400 });
  }

  const apiKey = body.apiKey?.trim();
  const model = body.model?.trim();

  if (apiKey && !/^sk-ant-[\w-]{10,}$/.test(apiKey)) {
    return NextResponse.json(
      { error: "รูปแบบคีย์ไม่ถูกต้อง — ควรขึ้นต้นด้วย sk-ant-" },
      { status: 400 },
    );
  }

  try {
    const file = path.join(process.cwd(), ENV_FILE);
    let content = "";
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      content = "";
    }
    if (apiKey) content = upsertEnv(content, "ANTHROPIC_API_KEY", apiKey);
    if (model) content = upsertEnv(content, "HINT_MODEL", model);
    await fs.writeFile(file, content, "utf8");

    return NextResponse.json({
      ok: true,
      message:
        "บันทึกลง .env.local แล้ว — ต้องรีสตาร์ท dev server (Ctrl+C แล้ว npm run dev) " +
        "ค่าใหม่ถึงจะมีผล",
    });
  } catch (error) {
    console.error("[/api/admin/config] เขียนไฟล์ไม่สำเร็จ:", error);
    return NextResponse.json({ error: "เขียน .env.local ไม่สำเร็จ" }, { status: 500 });
  }
}

/** PUT = ทดสอบว่าคีย์ที่ใช้อยู่ตอนนี้เรียก Claude ได้จริงไหม */
export async function PUT(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "รหัสผ่านหลังบ้านไม่ถูกต้อง" }, { status: 401 });
  }

  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    return NextResponse.json({
      ok: false,
      message: "ยังไม่ได้ตั้ง ANTHROPIC_API_KEY — เกมจะทำงานในโหมดสำรอง",
    });
  }

  try {
    const client = new Anthropic({ apiKey: key, maxRetries: 0 });
    const started = Date.now();
    const message = await client.messages.create(
      {
        model: HINT_MODEL,
        max_tokens: 4000,
        messages: [{ role: "user", content: 'ตอบกลับคำเดียวว่า "พร้อม"' }],
      },
      { timeout: 30_000 },
    );
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    return NextResponse.json({
      ok: true,
      message: `เชื่อมต่อสำเร็จ (${Date.now() - started} ms) · โมเดล ${message.model}`,
      reply: text.slice(0, 80),
      usage: message.usage,
    });
  } catch (error) {
    const detail =
      error instanceof Anthropic.APIError
        ? `HTTP ${error.status}: ${error.message}`
        : String(error);
    return NextResponse.json({ ok: false, message: `เรียก Claude ไม่สำเร็จ — ${detail}` });
  }
}
