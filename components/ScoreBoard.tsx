"use client";

import { useGame } from "@/lib/gameStore";
import { MAX_TOKENS } from "@/lib/scoring";
import type { PlayerId } from "@/lib/types";

function TokenPips({ count }: { count: number }) {
  return (
    <span className="inline-flex gap-1" aria-label={`โทเคนคำใบ้ ${count} ชิ้น`}>
      {Array.from({ length: MAX_TOKENS }).map((_, i) => (
        <span
          key={i}
          className={`h-2.5 w-2.5 rounded-full ${
            i < count ? "bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.8)]" : "bg-white/15"
          }`}
        />
      ))}
    </span>
  );
}

interface ScoreBoardProps {
  /** ไฮไลต์ผู้เล่นที่กำลังมีสิทธิ์ตอบ */
  activePlayer?: PlayerId | null;
}

export default function ScoreBoard({ activePlayer = null }: ScoreBoardProps) {
  const { state } = useGame();

  const players: Array<{
    id: PlayerId;
    name: string;
    score: number;
    tokens: number;
    accent: string;
  }> = [
    {
      id: 1,
      name: state.player1Name || "ผู้เล่น 1",
      score: state.player1Score,
      tokens: state.player1Tokens,
      accent: "from-fuchsia-500/25 to-violet-500/10 border-fuchsia-400/50",
    },
    {
      id: 2,
      name: state.player2Name || "ผู้เล่น 2",
      score: state.player2Score,
      tokens: state.player2Tokens,
      accent: "from-cyan-500/25 to-sky-500/10 border-cyan-400/50",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {players.map((p) => {
        const isActive = activePlayer === p.id;
        return (
          <div
            key={p.id}
            className={`panel bg-gradient-to-br p-3 transition-all duration-200 ${
              isActive ? `${p.accent} shadow-glow` : "border-stage-edge/70"
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-semibold text-slate-200">
                {p.name}
              </span>
              {isActive ? (
                <span className="chip shrink-0 bg-white/15 text-[10px] text-white">
                  ถึงตา
                </span>
              ) : null}
            </div>
            <div className="tabular mt-1 text-3xl font-extrabold leading-none text-white">
              {p.score}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-slate-400">โทเคนคำใบ้</span>
              <TokenPips count={p.tokens} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
