import { NextResponse, type NextRequest } from "next/server";
import {
  LLM_PROVIDERS,
  listModels,
  sanitizeApiKey,
  type LlmProvider,
  type ModelOption,
} from "@/lib/llm";
import { GUARD_RULES, guardApi } from "@/lib/apiGuard";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/admin/models  { provider, apiKey? }
 *   → { provider, models: [{ id, label }] }
 *
 * ใช้เติมดรอปดาวน์ "เลือกโมเดล" ในหลังบ้าน
 * ดึงรายชื่อจริงจากผู้ให้บริการ ไม่ใช่ลิสต์ที่ hardcode ไว้ในโค้ด จะได้ไม่ล้าสมัย
 *
 * เป็น POST ไม่ใช่ GET เพราะคีย์ที่หลังบ้านกรอกเองต้องเดินทางใน body
 * ถ้าใส่ไปกับ query string มันจะไปโผล่ใน log ของเซิร์ฟเวอร์และ history ของเบราว์เซอร์
 */

export interface AdminModelsResponse {
  provider: LlmProvider;
  models: ModelOption[];
  /** null = ดึงสำเร็จ · มีค่า = สาเหตุจริงที่ดึงไม่ได้ ให้เอาไปแสดงตรง ๆ */
  error: string | null;
}

function authorized(request: NextRequest): boolean {
  const expected = process.env.ADMIN_PASSWORD?.trim();
  if (!expected) return true;
  return request.headers.get("x-admin-password") === expected;
}

export async function POST(request: NextRequest) {
  // ด่านกันเงินรั่ว — ต้องเป็นบรรทัดแรกของ handler ก่อนจะอ่าน body ด้วยซ้ำ
  // ไม่งั้นคนยิงถล่มจะได้ parse ก้อน 8MB ฟรีทุกคำขอ
  const blocked = await guardApi(request, GUARD_RULES.admin);
  if (blocked) return blocked;

  if (!authorized(request)) {
    return NextResponse.json({ error: "รหัสผ่านหลังบ้านไม่ถูกต้อง" }, { status: 401 });
  }

  let body: { provider?: string; apiKey?: string };
  try {
    body = (await request.json()) as { provider?: string; apiKey?: string };
  } catch {
    return NextResponse.json({ error: "รูปแบบ JSON ไม่ถูกต้อง" }, { status: 400 });
  }

  const raw = body.provider;
  if (!raw || !(LLM_PROVIDERS as string[]).includes(raw)) {
    return NextResponse.json({ error: "ไม่รู้จักผู้ให้บริการนี้" }, { status: 400 });
  }

  const provider = raw as LlmProvider;
  const result = await listModels(provider, sanitizeApiKey(body.apiKey) ?? undefined);
  const payload: AdminModelsResponse = {
    provider,
    models: result.models,
    error: result.error,
  };
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
