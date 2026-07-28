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
export default function RoomPanel({ defaultName }: { defaultName: string }) {
  const {
    session,
    members,
    backend,
    error,
    busy,
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
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            ทีมละ 2 คนใช้คอมคนละเครื่องได้ — เปิดห้องแล้วส่งลิงก์ให้เพื่อน
            ทุกเครื่องจะเห็นคำถาม นาฬิกา และกล่องคำใบ้ชุดเดียวกัน
          </p>
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-slate-300">
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
          <span className="text-[10px] text-slate-500">หรือเข้าห้องที่เพื่อนเปิดไว้</span>
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
          <p className="mt-0.5 text-[11px] text-slate-400">
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
        <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-sky-200/80">
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

      {copied ? <p className="text-center text-[11px] text-teal-200">✓ {copied}</p> : null}

      <div>
        <p className="mb-1.5 text-[11px] font-semibold text-slate-300">
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
                <span className="ml-auto shrink-0 text-[10px] text-sky-300">เจ้าภาพ</span>
              ) : null}
              {m.id === session.memberId ? (
                <span className="ml-auto shrink-0 text-[10px] text-slate-500">คุณ</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {backend === "memory" ? (
        <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
          ⚠️ เซิร์ฟเวอร์ยังเก็บห้องไว้ในหน่วยความจำ — ใช้ทดสอบในเครื่องได้ปกติ
          แต่บนเซิร์ฟเวอร์จริงห้องจะหลุดเป็นช่วง ๆ ต้องต่อ Redis ก่อนถึงจะใช้งานจริงได้
          (ดูวิธีใน docs/DEVELOPMENT.md)
        </p>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-rose-400/50 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {error}
        </p>
      ) : null}
    </section>
  );
}
