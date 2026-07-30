"use client";

import { useEffect, useState } from "react";
import { useRoom } from "@/lib/roomClient";
import { isRoomCode, normalizeRoomCode, roomJoinUrl } from "@/lib/room";

/**
 * กล่องจัดการห้องบนหน้าตั้งค่า
 *
 * เจ้าภาพ = เครื่องที่คุมเกมจริง (กดเริ่ม กดตอบ กดข้อถัดไป)
 * ผู้ติดตาม = เพื่อนร่วมทีมที่ใช้อีกเครื่อง เห็นทุกอย่างตามและส่งข้อเสนอกลับได้
 */
/**
 * กล่องบอกว่ายังไม่ได้ต่อที่เก็บถาวร
 *
 * ของเดิมเขียนว่า "ดูวิธีใน docs/DEVELOPMENT.md" ซึ่งเป็นทางตันสำหรับคนที่เปิดจาก
 * เว็บที่ deploy แล้ว — เขาไม่มีซอร์สโค้ดอยู่ตรงหน้า จึงย้ายขั้นตอนจริงมาไว้ตรงนี้เลย
 * และพับเก็บไว้เป็นค่าเริ่มต้นเพื่อไม่ให้บังรายชื่อสมาชิกที่คนใช้บ่อยกว่า
 */
function MemoryNotice() {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);

  async function check() {
    setChecking(true);
    setResult(null);
    try {
      const res = await fetch("/api/room/health", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; detail: string };
      setResult(data);
    } catch (e) {
      setResult({ ok: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setChecking(false);
    }
  }

  return (
    <details className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
      <summary className="cursor-pointer list-none font-semibold">
        ⚠️ ยังไม่ได้ต่อที่เก็บถาวร — กดดูวิธีทำให้เสถียร
      </summary>

      <p className="mt-2">
        ตอนนี้ห้องเก็บอยู่ในหน่วยความจำของเซิร์ฟเวอร์ ถ้าเซิร์ฟเวอร์ลืมห้องไป
        เครื่องเจ้าภาพจะปลุกห้องกลับมาให้เองด้วยรหัสเดิม เล่นต่อได้โดยไม่ต้องเปิดห้องใหม่
        — แต่ถ้าบังเอิญคำขอของแต่ละเครื่องวิ่งไปคนละเครื่องเซิร์ฟเวอร์
        ผู้ติดตามอาจค้างอยู่พักหนึ่ง ต่อ Redis แล้วปัญหานี้จะหมดไปเลย
      </p>

      <ol className="mt-2 list-decimal space-y-1 pl-4">
        <li>
          สมัคร{" "}
          <a
            href="https://upstash.com"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-link underline"
          >
            upstash.com
          </a>{" "}
          (มีแพ็กฟรี) แล้วกด Create Database เลือก region ใกล้ไทยที่สุด เช่น Singapore
        </li>
        <li>
          ในหน้า database เลื่อนหาหัวข้อ <b>REST API</b> จะเจอค่าสองตัวคือ{" "}
          <code className="rounded bg-black/30 px-1">UPSTASH_REDIS_REST_URL</code> และ{" "}
          <code className="rounded bg-black/30 px-1">UPSTASH_REDIS_REST_TOKEN</code>
        </li>
        <li>
          เอาไปใส่ที่ Vercel → โปรเจกต์นี้ → Settings → Environment Variables
          (ถ้ารันในเครื่องให้ใส่ในไฟล์ <code className="rounded bg-black/30 px-1">.env.local</code>)
        </li>
        <li>
          กด Redeploy หนึ่งครั้ง — ค่า env ใหม่จะมีผลหลัง deploy เท่านั้น ไม่ใช่ทันทีที่กดบันทึก
        </li>
      </ol>

      <p className="mt-2 text-amber-200/80">
        ต้องเป็นคู่ที่ขึ้นต้นด้วย <code className="rounded bg-black/30 px-1">https://</code> เท่านั้น
        ค่าที่เป็น <code className="rounded bg-black/30 px-1">redis://…</code> ใช้กับที่นี่ไม่ได้
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button onClick={() => void check()} disabled={checking} className="btn-ghost text-xs">
          {checking ? "กำลังทดสอบ…" : "ทดสอบการเชื่อมต่อ"}
        </button>
        {result ? (
          <span className={result.ok ? "text-teal-200" : "text-amber-200"}>
            {result.ok ? "✓ " : "• "}
            {result.detail}
          </span>
        ) : null}
      </div>
    </details>
  );
}

/**
 * ปุ่มเริ่มเกมที่อยู่ในกล่องนี้เลย ไม่ต้องเลื่อนลงไปหาปุ่มล่างสุด
 *
 * ผู้ใช้รายงานว่าเปิดห้อง ชวนเพื่อนเข้ามาแล้ว แต่ปุ่มเริ่มอยู่ท้ายหน้าตั้งค่า
 * ซึ่งเป็นคนละที่กับตรงที่เพิ่งทำงานเสร็จ — บนแท็บเล็ตต้องเลื่อนผ่านการ์ดเลือกโหมด
 * ช่องกรอกชื่อ และตารางกติกาทั้งหมดกว่าจะเจอ จนดูเหมือนว่าเล่นข้ามเครื่องแล้ว
 * เริ่มเกมไม่ได้ · ปุ่มนี้เรียกตัวเดียวกับปุ่มล่างสุด ไม่ได้แยกเส้นทางเริ่มเกมใหม่
 *
 * `missing` มาจากหน้าตั้งค่า ใช้บอกว่ายังขาดช่องไหน — ถ้าไม่บอก ผู้ใช้จะเจอ
 * ปุ่มที่กดไม่ได้โดยไม่รู้ว่าทำไม ซึ่งเป็นปัญหาเดิมที่เพิ่งแก้ไปกับปุ่มล่างสุด
 */
function StartHere({
  onStart,
  starting,
  missing,
  label,
}: {
  onStart: () => void;
  starting: boolean;
  missing: string[];
  label: string;
}) {
  return (
    <div className="space-y-1.5 border-t border-white/10 pt-3">
      <button
        onClick={onStart}
        disabled={starting || missing.length > 0}
        className="btn-primary w-full text-sm"
      >
        {starting ? "กำลังเตรียมคำถาม..." : label}
      </button>
      {missing.length > 0 ? (
        <p className="text-center text-xs text-amber-200/90">
          ยังไม่ได้กรอก: {missing.join(" · ")} — เลื่อนลงไปกรอกให้ครบก่อน
        </p>
      ) : null}
    </div>
  );
}

export default function RoomPanel({
  defaultName,
  onStart,
  starting = false,
  missing = [],
}: {
  defaultName: string;
  /** ไม่ส่งมา = จอที่เริ่มเกมเองไม่ได้ (จอผู้ติดตาม) จะไม่มีปุ่มเริ่มเกม */
  onStart?: () => void;
  starting?: boolean;
  missing?: string[];
}) {
  const {
    session,
    members,
    backend,
    error,
    busy,
    reconnecting,
    isHost,
    createRoom,
    joinRoom,
    leaveRoom,
  } = useRoom();

  const [name, setName] = useState(defaultName);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    // เปิดมาจากลิงก์เชิญ → เติมรหัสให้เลย ผู้ใช้แค่ใส่ชื่อกับกดเข้าห้อง
    const invited = new URLSearchParams(window.location.search).get("room");
    if (invited) setCode(normalizeRoomCode(invited));
  }, []);

  useEffect(() => {
    if (defaultName && !name) setName(defaultName);
    // ตั้งใจ sync จาก defaultName ทางเดียว ไม่งั้นจะทับสิ่งที่ผู้ใช้พิมพ์เอง
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultName]);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied("คัดลอกไม่ได้ — กดค้างเพื่อคัดลอกเอง");
    }
  }

  // ── ยังไม่ได้อยู่ห้องไหน ──────────────────────────────────────────────────
  if (!session) {
    return (
      <section className="panel space-y-3 p-4">
        <div>
          <h2 className="text-sm font-bold text-white">เล่นข้ามเครื่อง</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            ทีมละ 2 คนใช้คอมคนละเครื่องได้ — เปิดห้องแล้วส่งลิงก์ให้เพื่อน
            ทุกเครื่องจะเห็นคำถาม นาฬิกา และกล่องคำใบ้ชุดเดียวกัน
          </p>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-300">
            ชื่อของคุณ
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="เช่น ตี๋"
            className="field"
          />
        </label>

        <button
          onClick={() => void createRoom(name.trim())}
          disabled={busy || !name.trim()}
          className="btn-primary w-full text-sm"
        >
          เปิดห้องใหม่ (เครื่องนี้คุมเกม)
        </button>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-white/10" />
          <span className="text-xs text-slate-500">หรือเข้าห้องที่เพื่อนเปิดไว้</span>
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
            placeholder="รหัส 5 ตัว"
            maxLength={5}
            spellCheck={false}
            className="field flex-1 text-center font-mono text-lg tracking-[0.3em]"
          />
          <button
            onClick={() => void joinRoom(code, name.trim())}
            disabled={busy || !name.trim() || !isRoomCode(code)}
            className="btn-teal shrink-0 text-sm"
          >
            เข้าห้อง
          </button>
        </div>

        {error ? (
          <p className="rounded-lg border border-rose-400/50 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
            {error}
          </p>
        ) : null}

        {onStart ? (
          <StartHere
            onStart={onStart}
            starting={starting}
            missing={missing}
            label="เริ่มเกมบนเครื่องนี้เครื่องเดียว"
          />
        ) : null}
      </section>
    );
  }

  // ── อยู่ในห้องแล้ว ────────────────────────────────────────────────────────
  const link = roomJoinUrl(origin, session.code);

  return (
    <section className="panel space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white">
            {isHost ? "คุณเป็นเจ้าภาพห้องนี้" : "คุณกำลังตามห้องนี้อยู่"}
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {isHost
              ? "เครื่องนี้คุมเกม กดเริ่มและกดตอบจากที่นี่"
              : "รอเจ้าภาพกดเริ่มเกม แล้วจอจะตามอัตโนมัติ"}
          </p>
        </div>
        <button onClick={() => void leaveRoom()} className="btn-ghost shrink-0 text-xs">
          ออกจากห้อง
        </button>
      </div>

      <div className="rounded-xl border border-sky-400/40 bg-sky-500/10 p-3 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-sky-200/80">
          รหัสห้อง
        </p>
        <p className="mt-1 font-mono text-3xl font-extrabold tracking-[0.35em] text-white">
          {session.code}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => void copy(session.code, "รหัส")} className="btn-ghost text-xs">
          คัดลอกรหัส
        </button>
        <button onClick={() => void copy(link, "ลิงก์")} className="btn-ghost text-xs">
          คัดลอกลิงก์เชิญ
        </button>
      </div>

      {copied ? <p className="text-center text-xs text-teal-200">✓ {copied}</p> : null}

      <div>
        <p className="mb-1.5 text-xs font-semibold text-slate-300">
          อยู่ในห้องตอนนี้ ({members.length})
        </p>
        <ul className="space-y-1">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-2 rounded-lg border border-stage-edge bg-white/[0.03] px-3 py-1.5 text-xs"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal-400" />
              <span className="truncate text-slate-100">{m.name}</span>
              {m.isHost ? (
                <span className="ml-auto shrink-0 text-xs text-sky-300">เจ้าภาพ</span>
              ) : null}
              {m.id === session.memberId ? (
                <span className="ml-auto shrink-0 text-xs text-slate-500">คุณ</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {reconnecting ? (
        <p className="rounded-lg border border-sky-400/40 bg-sky-500/10 px-3 py-2 text-xs leading-relaxed text-sky-100">
          <span className="mr-1 inline-block animate-pulse">●</span>
          หลุดจากเซิร์ฟเวอร์ชั่วคราว กำลังต่อกลับให้อัตโนมัติ…{" "}
          {isHost ? "เครื่องนี้ถือสถานะเกมอยู่ ไม่ต้องทำอะไร" : "รอเจ้าภาพสักครู่ อย่าเพิ่งปิดแท็บ"}
        </p>
      ) : null}

      {backend === "memory" ? <MemoryNotice /> : null}

      {error ? (
        <p className="rounded-lg border border-rose-400/50 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {error}
        </p>
      ) : null}

      {/* เจ้าภาพเท่านั้นที่กดเริ่มได้ ผู้ติดตามกดไม่ได้อยู่แล้วเพราะไม่ได้ถือสถานะเกม */}
      {onStart && isHost ? (
        <StartHere
          onStart={onStart}
          starting={starting}
          missing={missing}
          label={`เริ่มเกม — ทุกคนในห้องจะตามจอนี้ (${members.length} เครื่อง)`}
        />
      ) : null}
    </section>
  );
}
