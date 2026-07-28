import { NextResponse, type NextRequest } from "next/server";
import { LLM_PROVIDERS, listModels, type LlmProvider, type ModelOption } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/admin/models?provider=openrouter
 *   → { provider, models: [{ id, label }] }
 *
 * ใช้เติมดรอปดาวน์ "เลือกโมเดล" ในหลังบ้าน
 * ดึงรายชื่อจริงจากผู้ให้บริการ ไม่ใช่ลิสต์ที่ hardcode ไว้ในโค้ด จะได้ไม่ล้าสมัย
 */

export interface AdminModelsResponse {
  provider: LlmProvider;
  models: ModelOption[];
}

function authorized(request: NextRequest): boolean {
  const expected = process.env.ADMIN_PASSWORD?.trim();
  if (!expected) return true;
  return request.headers.get("x-admin-password") === expected;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "รหัสผ่านหลังบ้านไม่ถูกต้อง" }, { status: 401 });
  }

  const raw = request.nextUrl.searchParams.get("provider");
  if (!raw || !(LLM_PROVIDERS as string[]).includes(raw)) {
    return NextResponse.json({ error: "ไม่รู้จักผู้ให้บริการนี้" }, { status: 400 });
  }

  const provider = raw as LlmProvider;
  const payload: AdminModelsResponse = {
    provider,
    models: await listModels(provider),
  };
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
