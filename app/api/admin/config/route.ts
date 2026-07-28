import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import {
  LLM_PROVIDERS,
  PROVIDER_LABEL,
  anthropicKey,
  envChoice,
  isProviderReady,
  ollamaBaseUrl,
  openRouterKey,
  resolveLlm,
  sanitizeModel,
  testLlm,
  type LlmProvider,
} from "@/lib/llm";

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
 *
 * การ "เลือกเจ้า/เลือกโมเดล" ไม่ผ่านที่นี่ — เก็บใน localStorage ของหลังบ้าน
 * แล้วแนบไปกับ request ตอนเล่นจริง จึงเปลี่ยนได้แม้อยู่บน production
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

export interface ProviderStatus {
  provider: LlmProvider;
  label: string;
  /** พร้อมใช้งานไหม (มีคีย์แล้ว / ไม่ต้องใช้คีย์) */
  ready: boolean;
  /** ชื่อ env ที่ต้องตั้ง — Ollama ไม่ต้องใช้คีย์จึงเป็น null */
  envKey: string | null;
  maskedKey: string | null;
  note: string;
}

export interface AdminConfigResponse {
  providers: ProviderStatus[];
  /** ค่าตั้งต้นฝั่งเซิร์ฟเวอร์ ใช้เมื่อหลังบ้านยังไม่ได้เลือกอะไร */
  serverProvider: LlmProvider;
  serverModel: string;
  ollamaBaseUrl: string;
  /** แก้คีย์ผ่านหน้าเว็บได้ไหม (dev เท่านั้น) */
  writable: boolean;
  passwordRequired: boolean;
  environment: string;
  hasRevealSecret: boolean;
  locked?: boolean;
}

function buildStatus(): ProviderStatus[] {
  const anthropic = anthropicKey();
  const openrouter = openRouterKey();
  return [
    {
      provider: "anthropic",
      label: PROVIDER_LABEL.anthropic,
      ready: Boolean(anthropic),
      envKey: "ANTHROPIC_API_KEY",
      maskedKey: anthropic ? maskKey(anthropic) : null,
      note: "คุณภาพคำใบ้ดีที่สุด เพราะ prompt ทั้งหมดเขียนจูนมากับ Claude",
    },
    {
      provider: "openrouter",
      label: PROVIDER_LABEL.openrouter,
      ready: Boolean(openrouter),
      envKey: "OPENROUTER_API_KEY",
      maskedKey: openrouter ? maskKey(openrouter) : null,
      note: "คีย์เดียวเรียกได้หลายร้อยโมเดล จ่ายตามใช้จริง",
    },
    {
      provider: "ollama",
      label: PROVIDER_LABEL.ollama,
      ready: true,
      envKey: null,
      maskedKey: null,
      note:
        "ฟรีและไม่ต้องมีคีย์ แต่เซิร์ฟเวอร์ต้องต่อถึงเครื่องที่รัน Ollama ได้ — " +
        "บน Vercel จะเรียก localhost ของคุณไม่ได้ ใช้ได้เฉพาะตอนรันในเครื่อง",
    },
  ];
}

export async function GET(request: NextRequest) {
  const fromEnv = envChoice();
  const payload: AdminConfigResponse = {
    providers: buildStatus(),
    serverProvider: fromEnv.provider,
    serverModel: fromEnv.model,
    ollamaBaseUrl: ollamaBaseUrl(),
    writable: !IS_PROD,
    passwordRequired: Boolean(process.env.ADMIN_PASSWORD?.trim()),
    environment: IS_PROD ? "production" : "development",
    hasRevealSecret: Boolean(process.env.REVEAL_SECRET?.trim()),
  };

  if (payload.passwordRequired && !authorized(request)) {
    return NextResponse.json(
      {
        ...payload,
        providers: payload.providers.map((p) => ({
          ...p,
          ready: false,
          maskedKey: null,
        })),
        locked: true,
      },
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

interface SaveBody {
  provider?: string;
  model?: string;
  anthropicKey?: string;
  openRouterKey?: string;
  ollamaBaseUrl?: string;
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

  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "รูปแบบ JSON ไม่ถูกต้อง" }, { status: 400 });
  }

  const claudeKey = body.anthropicKey?.trim();
  const routerKey = body.openRouterKey?.trim();
  const ollamaUrl = body.ollamaBaseUrl?.trim();
  const provider = body.provider?.trim();
  const model = body.model?.trim();

  if (claudeKey && !/^sk-ant-[\w-]{10,}$/.test(claudeKey)) {
    return NextResponse.json(
      { error: "คีย์ Anthropic ไม่ถูกรูปแบบ — ควรขึ้นต้นด้วย sk-ant-" },
      { status: 400 },
    );
  }
  if (routerKey && !/^sk-or-[\w-]{10,}$/.test(routerKey)) {
    return NextResponse.json(
      { error: "คีย์ OpenRouter ไม่ถูกรูปแบบ — ควรขึ้นต้นด้วย sk-or-" },
      { status: 400 },
    );
  }
  if (ollamaUrl && !/^https?:\/\/[\w.-]+(:\d+)?\/?$/.test(ollamaUrl)) {
    return NextResponse.json(
      { error: "URL ของ Ollama ไม่ถูกรูปแบบ — ตัวอย่าง http://127.0.0.1:11434" },
      { status: 400 },
    );
  }
  if (provider && !(LLM_PROVIDERS as string[]).includes(provider)) {
    return NextResponse.json({ error: "ไม่รู้จักผู้ให้บริการนี้" }, { status: 400 });
  }
  if (model && !sanitizeModel(model)) {
    return NextResponse.json({ error: "ชื่อโมเดลมีอักขระที่ใช้ไม่ได้" }, { status: 400 });
  }

  try {
    const file = path.join(process.cwd(), ENV_FILE);
    let content = "";
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      content = "";
    }
    if (claudeKey) content = upsertEnv(content, "ANTHROPIC_API_KEY", claudeKey);
    if (routerKey) content = upsertEnv(content, "OPENROUTER_API_KEY", routerKey);
    if (ollamaUrl) content = upsertEnv(content, "OLLAMA_BASE_URL", ollamaUrl);
    if (provider) content = upsertEnv(content, "LLM_PROVIDER", provider);
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

/**
 * PUT = ทดสอบว่าเจ้า+โมเดลที่ระบุมาเรียกได้จริงไหม
 * ถ้าไม่ส่ง body มาจะทดสอบค่าตั้งต้นของเซิร์ฟเวอร์
 */
export async function PUT(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "รหัสผ่านหลังบ้านไม่ถูกต้อง" }, { status: 401 });
  }

  let requested: { provider?: string; model?: string } | null = null;
  try {
    requested = (await request.json()) as { provider?: string; model?: string };
  } catch {
    requested = null;
  }

  const choice = resolveLlm(requested);
  if (!isProviderReady(choice.provider)) {
    const envKey =
      choice.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENROUTER_API_KEY";
    return NextResponse.json({
      ok: false,
      message: `ยังไม่ได้ตั้ง ${envKey} — เกมจะทำงานในโหมดสำรอง`,
    });
  }

  return NextResponse.json(await testLlm(choice));
}
