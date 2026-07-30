"use client";

import { useRoom } from "@/lib/roomClient";

/**
 * ข้อเสนอที่เพื่อนร่วมทีมส่งมาจากเครื่องอื่น — แสดงบนจอเจ้าภาพระหว่างตอบ
 *
 * กรองตาม questionId เสมอ เพราะข้อเสนอค้างจากข้อก่อนหน้าถ้าโผล่มาในข้อใหม่
 * จะทำให้คนกดตอบสับสนว่ากำลังพูดถึงข้อไหน
 */
export default function TeammateNotes({ questionId }: { questionId: string }) {
  const { session, intents, isHost, clearIntents } = useRoom();
  if (!session) return null;

  const current = intents.filter((i) => i.questionId === questionId);
  if (current.length === 0) return null;

  return (
    <section className="panel space-y-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-sky-200">
          💬 เพื่อนร่วมทีมส่งมา ({current.length})
        </h3>
        {isHost ? (
          <button onClick={() => void clearIntents()} className="text-xs text-slate-400 hover:text-slate-200">
            ล้าง
          </button>
        ) : null}
      </div>
      <ul className="space-y-1.5">
        {current.slice(-5).map((i) => (
          <li
            key={i.id}
            className="rounded-lg border border-stage-edge bg-white/[0.04] px-3 py-2 text-xs leading-relaxed"
          >
            <span className="font-semibold text-sky-200">{i.memberName}:</span>{" "}
            <span className="text-slate-100">{i.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
