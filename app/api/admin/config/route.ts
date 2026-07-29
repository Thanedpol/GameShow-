import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import {
  LLM_PROVIDERS,
  PROVIDER_LABEL,
  envChoice,
  isChoiceReady,
  isProviderReady,
  ollamaBaseUrl,
  providerEnvKey,
  providerKey,
  resolveLlm,
  sanitizeModel,
  testLlm,
  type LlmChoiceInput,
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

/**
 * ชื่อ env ที่ "ดูเหมือนตั้งใจจะเป็นคีย์ของเรา" แต่สะกดไม่ตรง
 *
 * มีไว้จับเคสที่เจอบ่อยตอนตั้งค่าบน Vercel — พิมพ์ชื่อผิด มีช่องว่างต่อท้าย
 * หรือใช้ชื่อคนละแบบ แสดงเฉพาะ "ชื่อ" ไม่เคยแสดงค่า
 */
const EXPECTED_ENV = new Set([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "OLLAMA_BASE_URL",
  "LLM_PROVIDER",
  "HINT_MODEL",
  "REVEAL_SECRET",
  "ADMIN_PASSWORD",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
]);

const LOOKS_LIKE_OURS = /GEMINI|OPENAI|ANTHROPIC|OPENROUTER|OLLAMA|API_KEY|LLM_|HINT_MODEL/i;

const EXPECTED_LOWER = new Map(
  [...EXPECTED_ENV].map((name) => [name.toLowerCase(), name] as const),
);

interface EnvNameReport {
  /** ชื่อที่ไม่ตรงเลย แม้เทียบแบบไม่สนตัวพิมพ์ — สะกดผิดจริง ใช้งานไม่ได้ */
  misspelled: string[];
  /** ชื่อที่ต่างแค่ตัวพิมพ์เล็ก/ใหญ่ — ระบบอ่านให้แล้ว แต่ควรตั้งให้ตรงมาตรฐาน */
  wrongCase: Array<{ found: string; expected: string }>;
}

function inspectEnvNames(): EnvNameReport {
  const misspelled: string[] = [];
  const wrongCase: Array<{ found: string; expected: string }> = [];

  for (const name of Object.keys(process.env)) {
    if (!LOOKS_LIKE_OURS.test(name) || EXPECTED_ENV.has(name)) continue;
    const expected = EXPECTED_LOWER.get(name.toLowerCase());
    if (expected) wrongCase.push({ found: name, expected });
    else misspelled.push(name);
  }
  return { misspelled: misspelled.slice(0, 20), wrongCase: wrongCase.slice(0, 20) };
}

export interface AdminConfigResponse {
  providers: ProviderStatus[];
  /** ชื่อ env ที่สะกดผิดจริง ใช้งานไม่ได้ */
  misspelledEnv: string[];
  /** ชื่อ env ที่ต่างแค่ตัวพิมพ์ — ระบบอ่านให้แล้ว แต่ควรตั้งให้ตรง */
  wrongCaseEnv: Array<{ found: string; expected: string }>;
  /** ข้อมูล deployment ที่กำลังรัน ใช้เทียบกับหน้า Vercel เวลาตั้งค่าแล้วไม่ขึ้น */
  deployment: {
    /** production | preview | development — env ที่ตั้งไว้คนละช่องกับอันนี้จะไม่ถูกอ่าน */
    vercelEnv: string | null;
    commitSha: string | null;
    branch: string | null;
    /** จำนวน env ทั้งหมดที่ runtime มองเห็น ใช้ดูว่า env ถูกใส่มาจริงไหม */
    envCount: number;
  };
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

const PROVIDER_NOTE: Record<LlmProvider, string> = {
  anthropic: "คุณภาพคำใบ้ดีที่สุด เพราะ prompt ทั้งหมดเขียนจูนมากับ Claude",
  openai: "GPT ของ OpenAI — คีย์จาก platform.openai.com",
  gemini: "Gemini ของ Google — คีย์จาก aistudio.google.com มีโควตาฟรีให้ลอง",
  openrouter: "คีย์เดียวเรียกได้หลายร้อยโมเดล จ่ายตามใช้จริง",
  ollama:
    "ฟรีและไม่ต้องมีคีย์ แต่เซิร์ฟเวอร์ต้องต่อถึงเครื่องที่รัน Ollama ได้ — " +
    "บน Vercel จะเรียก localhost ของคุณไม่ได้ ใช้ได้เฉพาะตอนรันในเครื่อง",
};

function buildStatus(): ProviderStatus[] {
  return LLM_PROVIDERS.map((provider) => {
    const key = providerKey(provider);
    return {
      provider,
      label: PROVIDER_LABEL[provider],
      ready: isProviderReady(provider),
      envKey: providerEnvKey(provider),
      maskedKey: key ? maskKey(key) : null,
      note: PROVIDER_NOTE[provider],
    };
  });
}

export async function GET(request: NextRequest) {
  const fromEnv = envChoice();
  const envNames = inspectEnvNames();
  const payload: AdminConfigResponse = {
    providers: buildStatus(),
    misspelledEnv: envNames.misspelled,
    wrongCaseEnv: envNames.wrongCase,
    deployment: {
      // ตัวแปรระบบของ Vercel ไม่ใช่ความลับ เอามาโชว์ได้
      vercelEnv: process.env.VERCEL_ENV ?? null,
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      envCount: Object.keys(process.env).length,
    },
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
  /** คีย์รายเจ้า — ชื่อฟิลด์คือชื่อ provider เช่น { openai: "sk-..." } */
  keys?: Partial<Record<LlmProvider, string>>;
  ollamaBaseUrl?: string;
}

/**
 * ตรวจรูปแบบคีย์คร่าว ๆ เพื่อกันพิมพ์ผิด ไม่ได้ยืนยันว่าคีย์ใช้ได้จริง
 *
 * Google AI Studio ออกคีย์สองแบบ — ของเดิมขึ้นต้น AIza ของใหม่ขึ้นต้น AQ.
 * (มีจุดอยู่ในคีย์ด้วย) ต้องรับทั้งคู่ ไม่งั้นคีย์ที่ถูกต้องจะโดนตีกลับ
 */
const KEY_FORMAT: Partial<Record<LlmProvider, { pattern: RegExp; hint: string }>> = {
  anthropic: { pattern: /^sk-ant-[\w-]{10,}$/, hint: "ควรขึ้นต้นด้วย sk-ant-" },
  openai: { pattern: /^sk-[\w-]{20,}$/, hint: "ควรขึ้นต้นด้วย sk-" },
  gemini: {
    pattern: /^(AIza[\w-]{20,}|AQ\.[\w.-]{20,})$/,
    hint: "ควรขึ้นต้นด้วย AIza หรือ AQ.",
  },
  openrouter: { pattern: /^sk-or-[\w-]{10,}$/, hint: "ควรขึ้นต้นด้วย sk-or-" },
};

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

  const ollamaUrl = body.ollamaBaseUrl?.trim();
  const provider = body.provider?.trim();
  const model = body.model?.trim();

  // เก็บเป็นคู่ [ชื่อ env, ค่า] ไว้เขียนลงไฟล์ทีเดียวตอนท้าย
  const keyLines: Array<[string, string]> = [];
  for (const [name, raw] of Object.entries(body.keys ?? {})) {
    if (!(LLM_PROVIDERS as string[]).includes(name)) {
      return NextResponse.json({ error: `ไม่รู้จักผู้ให้บริการ ${name}` }, { status: 400 });
    }
    const value = raw?.trim();
    if (!value) continue;

    const target = name as LlmProvider;
    const envKey = providerEnvKey(target);
    if (!envKey) {
      return NextResponse.json(
        { error: `${PROVIDER_LABEL[target]} ไม่ต้องใช้คีย์` },
        { status: 400 },
      );
    }
    const format = KEY_FORMAT[target];
    if (format && !format.pattern.test(value)) {
      return NextResponse.json(
        { error: `คีย์ ${PROVIDER_LABEL[target]} ไม่ถูกรูปแบบ — ${format.hint}` },
        { status: 400 },
      );
    }
    keyLines.push([envKey, value]);
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
    for (const [envKey, value] of keyLines) content = upsertEnv(content, envKey, value);
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

  let requested: LlmChoiceInput | null = null;
  try {
    requested = (await request.json()) as LlmChoiceInput;
  } catch {
    requested = null;
  }

  // apiKey ที่แนบมาถูกใช้เฉพาะ request นี้ ไม่เขียนลงไฟล์และไม่ส่งกลับ
  const choice = resolveLlm(requested);
  if (!isChoiceReady(choice)) {
    return NextResponse.json({
      ok: false,
      message:
        `ยังไม่มีคีย์ให้ใช้ — ใส่ในช่อง API key แล้วกดบันทึก ` +
        `หรือตั้ง ${providerEnvKey(choice.provider)} บนเซิร์ฟเวอร์ · ตอนนี้เกมจะใช้โหมดสำรอง`,
    });
  }

  return NextResponse.json(await testLlm(choice));
}
