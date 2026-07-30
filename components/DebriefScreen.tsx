"use client";

import { useEffect, useRef, useState } from "react";
import { useGame } from "@/lib/gameStore";
import { MODE_LABEL, STAGE_LABEL, nameOfId, rankParticipants, winnersOf } from "@/lib/scoring";
import { llmRequestPayload } from "@/lib/settings";
import type { DebriefApiResponse } from "@/lib/types";

const FORMAT_LABEL = {
  choice: "ปรนัย",
  open: "อัตนัย",
  performance: "โชว์",
} as const;

export default function DebriefScreen() {
  const { state, dispatch } = useGame();
  const [debrief, setDebrief] = useState<DebriefApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/debrief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participants: state.participants.map((p) => ({ name: p.name, score: p.score })),
            hintHistory: state.hintHistory,
            llm: llmRequestPayload("debrief"),
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setDebrief((await res.json()) as DebriefApiResponse);
      } catch {
        setDebrief(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [state.participants, state.hintHistory]);

  const ranked = rankParticipants(state.participants);
  const winners = winnersOf(state.participants);
  const tie = winners.length > 1;

  const statsOf = (id: string) => {
    const rounds = state.roundLog.filter((r) => r.participantId === id);
    const good = rounds.filter((r) => r.points > 0).length;
    const boxes = rounds.reduce((sum, r) => sum + r.boxesOpened, 0);
    const steals = state.roundLog.filter(
      (r) => r.stealParticipantId === id && (r.stealPoints ?? 0) > 0,
    ).length;
    const avgQuality = rounds.length
      ? Math.round(rounds.reduce((s, r) => s + r.quality, 0) / rounds.length)
      : 0;
    return { asked: rounds.length, good, boxes, steals, avgQuality };
  };

  return (
    <div className="animate-popIn space-y-5">
      <header className="pt-3 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300/80">
          Debrief · {MODE_LABEL[state.mode]}
        </p>
        <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">
          {tie ? (
            <span className="text-slate-100">เสมอกัน!</span>
          ) : (
            <>
              <span className="bg-gradient-to-r from-cyan-300 to-sky-400 bg-clip-text text-transparent">
                {winners[0]?.name ?? "—"}
              </span>{" "}
              <span className="text-slate-100">คือผู้ชนะ</span>
            </>
          )}
        </h1>
      </header>

      {/* อันดับ */}
      <section className="space-y-2">
        {ranked.map((p, i) => {
          const s = statsOf(p.id);
          const isWinner = winners.some((w) => w.id === p.id);
          return (
            <div
              key={p.id}
              className={`panel p-4 ${
                isWinner ? "border-cyan-300/60 bg-cyan-400/10 shadow-glow" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="tabular w-6 shrink-0 text-lg font-bold text-slate-500">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-100">
                      {p.kind === "bot" ? "🤖 " : ""}
                      {p.name} {isWinner ? "🏆" : ""}
                    </p>
                    {p.members.length > 0 ? (
                      <p className="truncate text-xs text-slate-500">
                        {p.members.join(" · ")}
                      </p>
                    ) : null}
                  </div>
                </div>
                <span className="tabular shrink-0 text-3xl font-extrabold text-white">
                  {p.score}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400 sm:grid-cols-4">
                <div className="flex justify-between">
                  <dt>ได้คะแนน</dt>
                  <dd className="tabular text-slate-200">
                    {s.good}/{s.asked}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>คุณภาพเฉลี่ย</dt>
                  <dd className="tabular text-slate-200">{s.avgQuality}%</dd>
                </div>
                <div className="flex justify-between">
                  <dt>เปิดกล่อง</dt>
                  <dd className="tabular text-slate-200">{s.boxes}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>แย่งตอบสำเร็จ</dt>
                  <dd className="tabular text-slate-200">{s.steals}</dd>
                </div>
              </dl>
            </div>
          );
        })}
      </section>

      {/* สรุปจาก AI */}
      <section className="panel space-y-3 p-5">
        <h2 className="text-base font-bold text-white">สรุปจากโปรดิวเซอร์ (AI)</h2>
        {loading ? (
          <div className="flex items-center gap-3 py-2 text-sm text-slate-400">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/15 border-t-cyan-300" />
            กำลังให้ Claude สรุปว่ากล่องคำใบ้แต่ละกล่องถูกออกแบบแบบนั้นเพราะอะไร...
          </div>
        ) : debrief ? (
          <>
            <p className="text-sm leading-relaxed text-slate-200">{debrief.overall}</p>
            {debrief.source === "fallback" ? (
              <p className="text-xs text-cyan-200/70">
                (โหมดสำรอง — ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY จึงใช้ข้อความสำเร็จรูป)
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-rose-200">
            เรียกสรุปไม่สำเร็จ — แต่คะแนนและประวัติด้านล่างยังดูได้ตามปกติ
          </p>
        )}
      </section>

      {/* กล่องที่เปิดไป */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-white">
          กล่องคำใบ้ที่เปิดไปทั้งหมด ({state.hintHistory.length} กล่อง)
        </h2>
        {state.hintHistory.length === 0 ? (
          <p className="panel p-5 text-center text-sm text-slate-400">
            เกมนี้ไม่มีใครเปิดกล่องเลย — เล่นด้วยความรู้ล้วน ๆ
          </p>
        ) : (
          state.hintHistory.map((h, i) => {
            const note = debrief?.notes.find((n) => n.index === i);
            const truth = note?.truth;
            return (
              <article
                key={`${h.questionId}-${h.boxId}-${i}`}
                className={`rounded-2xl border p-4 ${
                  truth === "จริง"
                    ? "border-teal-300/45 bg-teal-400/[0.07]"
                    : truth === "หลอก"
                      ? "border-rose-400/45 bg-rose-500/[0.06]"
                      : "border-stage-edge bg-white/[0.03]"
                }`}
              >
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <span className="chip bg-white/10 text-slate-200">
                    {nameOfId(state.participants, h.participantId)}
                  </span>
                  <span className="chip bg-indigo-500/20 text-indigo-200">
                    กล่อง {h.boxLabel}
                  </span>
                  {truth ? (
                    <span
                      className={`chip ${
                        truth === "จริง"
                          ? "bg-teal-400/25 text-teal-100"
                          : "bg-rose-500/25 text-rose-100"
                      }`}
                    >
                      {truth === "จริง" ? "ใบ้จริง" : "ใบ้หลอก"}
                    </span>
                  ) : null}
                </div>
                <p className="text-sm leading-relaxed text-white">
                  &ldquo;{h.text}&rdquo;
                </p>
                {note?.note ? (
                  <p className="mt-2 rounded-lg bg-black/25 px-3 py-2 text-xs leading-relaxed text-slate-300">
                    <b className="text-slate-100">ทำไมถึงใบ้แบบนี้:</b> {note.note}
                  </p>
                ) : null}
              </article>
            );
          })
        )}
      </section>

      {/* ไทม์ไลน์ */}
      <section className="panel space-y-2 p-5">
        <h2 className="text-base font-bold text-white">ไทม์ไลน์รายข้อ</h2>
        <ol className="space-y-2 text-sm">
          {state.roundLog.map((r, i) => (
            <li
              key={`${r.questionId}-${i}`}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-white/5 pb-2 last:border-0"
            >
              <span className="tabular w-6 shrink-0 text-slate-500">{i + 1}.</span>
              <span className="text-xs text-slate-500">
                {STAGE_LABEL[r.stage]} · {FORMAT_LABEL[r.format]}
              </span>
              <span className="flex-1 basis-full text-slate-300 sm:basis-auto">
                {r.prompt}
              </span>
              <span
                className={`tabular shrink-0 font-bold ${
                  r.points > 0 ? "text-teal-300" : "text-slate-500"
                }`}
              >
                {nameOfId(state.participants, r.participantId)} +{r.points}
              </span>
              {r.stealParticipantId && (r.stealPoints ?? 0) > 0 ? (
                <span className="tabular shrink-0 font-bold text-cyan-300">
                  {nameOfId(state.participants, r.stealParticipantId)} +{r.stealPoints}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <button
        onClick={() => dispatch({ type: "RESET" })}
        className="btn-primary w-full py-4 text-lg"
      >
        เล่นใหม่
      </button>

      <p className="pb-4 text-center text-xs leading-relaxed text-slate-500">
        คำใบ้ทั้งหมดในเกมนี้สร้างขึ้นเพื่อความบันเทิงและฝึกการคิดวิเคราะห์
        ส่วนที่ถูกออกแบบให้หลอกเป็นเรื่องแต่ง ห้ามนำไปใช้อ้างอิงจริง
      </p>
    </div>
  );
}
