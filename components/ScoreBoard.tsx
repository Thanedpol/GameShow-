"use client";

import { useGame } from "@/lib/gameStore";
import type { Participant } from "@/lib/types";

const ACCENTS = [
  "border-sky-400/60 bg-sky-500/15",
  "border-teal-300/60 bg-teal-400/15",
  "border-indigo-400/60 bg-indigo-500/15",
  "border-cyan-300/60 bg-cyan-400/15",
];

function TokenPips({ count, max }: { count: number; max: number }) {
  return (
    <span className="inline-flex gap-1" aria-label={`โทเคนคำใบ้ ${count} ชิ้น`}>
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full ${
            i < count ? "bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.9)]" : "bg-white/15"
          }`}
        />
      ))}
    </span>
  );
}

/**
 * แถบคะแนนด้านบนจอ
 *
 * `participants` / `maxTokens` ส่งมาเองได้ สำหรับจอที่ไม่ได้ถือสถานะเกมของตัวเอง
 * (จอเพื่อนวาดจากสแนปช็อตของเจ้าภาพ ถ้าอ่าน useGame จะได้ผู้เล่นชุดว่างของเครื่องตัวเอง
 * แล้วแถบคะแนนจะหายไปทั้งแถบ ทำให้สองจอหน้าตาไม่ตรงกัน)
 */
export default function ScoreBoard({
  activeId = null,
  participants,
  maxTokens,
}: {
  activeId?: string | null;
  participants?: Participant[];
  maxTokens?: number;
}) {
  const { state } = useGame();
  const people = participants ?? state.participants;
  const tokenMax = maxTokens ?? state.settings.maxTokens;
  const cols = people.length >= 3 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2";

  return (
    <div className={`grid gap-2 ${cols}`}>
      {people.map((p, i) => {
        const active = activeId === p.id;
        return (
          <div
            key={p.id}
            className={`panel p-3 transition-all duration-200 ${
              active ? `${ACCENTS[i % ACCENTS.length]} shadow-glow` : "border-stage-edge/70"
            }`}
          >
            <div className="flex items-baseline justify-between gap-1">
              <span className="truncate text-xs font-semibold text-slate-200">
                {p.kind === "bot" ? "🤖 " : ""}
                {p.name}
              </span>
              {active ? (
                <span className="chip shrink-0 bg-white/15 px-2 py-0.5 text-xs text-white">
                  ถึงตา
                </span>
              ) : null}
            </div>
            {p.members.length > 0 ? (
              <p className="truncate text-xs text-slate-500">{p.members.join(" · ")}</p>
            ) : null}
            <div className="tabular mt-1 text-2xl font-extrabold leading-none text-white">
              {p.score}
            </div>
            <div className="mt-1.5">
              <TokenPips count={p.tokens} max={tokenMax} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
