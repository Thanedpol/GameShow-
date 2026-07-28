"use client";

import { useGame } from "@/lib/gameStore";
import { MAX_TOKENS } from "@/lib/scoring";

const ACCENTS = [
  "border-sky-400/60 bg-sky-500/15",
  "border-teal-300/60 bg-teal-400/15",
  "border-indigo-400/60 bg-indigo-500/15",
  "border-cyan-300/60 bg-cyan-400/15",
];

function TokenPips({ count }: { count: number }) {
  return (
    <span className="inline-flex gap-1" aria-label={`โทเคนคำใบ้ ${count} ชิ้น`}>
      {Array.from({ length: MAX_TOKENS }).map((_, i) => (
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

export default function ScoreBoard({ activeId = null }: { activeId?: string | null }) {
  const { state } = useGame();
  const cols = state.participants.length >= 3 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2";

  return (
    <div className={`grid gap-2 ${cols}`}>
      {state.participants.map((p, i) => {
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
                <span className="chip shrink-0 bg-white/15 px-2 py-0.5 text-[9px] text-white">
                  ถึงตา
                </span>
              ) : null}
            </div>
            {p.members.length > 0 ? (
              <p className="truncate text-[10px] text-slate-500">{p.members.join(" · ")}</p>
            ) : null}
            <div className="tabular mt-1 text-2xl font-extrabold leading-none text-white">
              {p.score}
            </div>
            <div className="mt-1.5">
              <TokenPips count={p.tokens} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
