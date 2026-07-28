"use client";

import { useEffect, useRef, useState } from "react";
import { nameOf, useGame } from "@/lib/gameStore";
import { STAGE_LABEL } from "@/lib/scoring";
import type { DebriefApiResponse, PlayerId } from "@/lib/types";

export default function DebriefScreen() {
  const { state, dispatch } = useGame();
  const [debrief, setDebrief] = useState<DebriefApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const fetchedRef = useRef(false);

  // ใช้ fetchedRef กันยิงซ้ำจาก StrictMode — และไม่ใช้ธง cancelled ในคลีนอัป
  // มิฉะนั้นรอบแรก (ที่ยิงจริง) จะถูกยกเลิกทิ้งโดยไม่มีใครยิงใหม่
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    (async () => {
      try {
        const res = await fetch("/api/debrief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            player1Name: state.player1Name,
            player2Name: state.player2Name,
            player1Score: state.player1Score,
            player2Score: state.player2Score,
            hintHistory: state.hintHistory,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as DebriefApiResponse;
        setDebrief(data);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [
    state.player1Name,
    state.player2Name,
    state.player1Score,
    state.player2Score,
    state.hintHistory,
  ]);

  const tie = state.player1Score === state.player2Score;
  const winner: PlayerId = state.player1Score >= state.player2Score ? 1 : 2;

  const stats = (player: PlayerId) => {
    const rounds = state.roundLog.filter((r) => r.answeringPlayer === player);
    const correct = rounds.filter((r) => r.wasCorrect).length;
    const hints = state.hintHistory.filter((h) => h.player === player);
    const steals = state.roundLog.filter((r) => r.stealPlayer === player && r.stealCorrect);
    return { asked: rounds.length, correct, hints: hints.length, steals: steals.length };
  };

  return (
    <div className="animate-popIn space-y-5">
      <header className="pt-3 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300/80">
          Debrief
        </p>
        <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">
          {tie ? (
            <span className="text-slate-100">เสมอกัน!</span>
          ) : (
            <>
              <span className="bg-gradient-to-r from-amber-300 to-orange-400 bg-clip-text text-transparent">
                {nameOf(state, winner)}
              </span>{" "}
              <span className="text-slate-100">คือผู้ชนะ</span>
            </>
          )}
        </h1>
      </header>

      {/* คะแนนรวม */}
      <div className="grid grid-cols-2 gap-3">
        {([1, 2] as PlayerId[]).map((p) => {
          const s = stats(p);
          const isWinner = !tie && winner === p;
          return (
            <div
              key={p}
              className={`panel p-4 ${
                isWinner ? "border-amber-300/60 bg-amber-400/10 shadow-glow" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-slate-200">
                  {nameOf(state, p)}
                </span>
                {isWinner ? <span className="text-lg">🏆</span> : null}
              </div>
              <div className="tabular mt-1 text-4xl font-extrabold text-white">
                {p === 1 ? state.player1Score : state.player2Score}
              </div>
              <dl className="mt-3 space-y-1 text-[11px] text-slate-400">
                <div className="flex justify-between">
                  <dt>ตอบถูก</dt>
                  <dd className="tabular text-slate-200">
                    {s.correct}/{s.asked}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>ขอ AI ช่วย</dt>
                  <dd className="tabular text-slate-200">{s.hints} ครั้ง</dd>
                </div>
                <div className="flex justify-between">
                  <dt>แย่งตอบสำเร็จ</dt>
                  <dd className="tabular text-slate-200">{s.steals} ครั้ง</dd>
                </div>
                <div className="flex justify-between">
                  <dt>โทเคนคงเหลือ</dt>
                  <dd className="tabular text-slate-200">
                    {p === 1 ? state.player1Tokens : state.player2Tokens}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>

      {/* สรุปภาพรวมจาก Claude */}
      <section className="panel space-y-3 p-5">
        <h2 className="text-base font-bold text-white">สรุปจากโปรดิวเซอร์ (AI)</h2>
        {loading ? (
          <div className="flex items-center gap-3 py-2 text-sm text-slate-400">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/15 border-t-cyan-300" />
            กำลังให้ Claude สรุปว่าคำใบ้แต่ละข้อถูกออกแบบมาแบบนั้นเพราะอะไร...
          </div>
        ) : failed ? (
          <p className="text-sm text-rose-200">
            เรียกสรุปไม่สำเร็จ — แต่คะแนนและประวัติคำใบ้ด้านล่างยังดูได้ตามปกติ
          </p>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-slate-200">{debrief?.overall}</p>
            {debrief?.source === "fallback" ? (
              <p className="text-xs text-amber-200/80">
                (โหมดสำรอง — ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY จึงใช้ข้อความสำเร็จรูป)
              </p>
            ) : null}
          </>
        )}
      </section>

      {/* คำใบ้ทุกชุดที่เคยขอ */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-white">
          คำใบ้ที่ขอไปทั้งหมด ({state.hintHistory.length} ชุด)
        </h2>

        {state.hintHistory.length === 0 ? (
          <p className="panel p-5 text-center text-sm text-slate-400">
            เกมนี้ไม่มีใครขอ AI ช่วยเลย — เล่นด้วยความรู้ล้วน ๆ
          </p>
        ) : (
          state.hintHistory.map((h, i) => {
            const note = debrief?.notes.find((n) => n.index === i);
            const truth = note?.truth;
            return (
              <article
                key={`${h.questionId}-${i}`}
                className={`rounded-2xl border p-4 ${
                  truth === "จริง"
                    ? "border-emerald-400/45 bg-emerald-500/[0.07]"
                    : truth === "หลอก"
                      ? "border-rose-400/45 bg-rose-500/[0.06]"
                      : "border-stage-edge bg-white/[0.03]"
                }`}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="chip bg-white/10 text-slate-200">
                    ผู้เล่น {h.player} · {nameOf(state, h.player)}
                  </span>
                  {h.fromFinalDuel ? (
                    <span className="chip bg-amber-400/20 text-amber-100">
                      รอบ AI Duel Final · ชุดที่เลือกเชื่อ
                    </span>
                  ) : (
                    <span className="chip bg-violet-500/20 text-violet-200">
                      โหมด &ldquo;ใบ้{h.hintType}&rdquo;
                    </span>
                  )}
                  {truth ? (
                    <span
                      className={`chip ${
                        truth === "จริง"
                          ? "bg-emerald-500/25 text-emerald-100"
                          : "bg-rose-500/25 text-rose-100"
                      }`}
                    >
                      {truth === "จริง" ? "เบาะแสจริงล้วน" : "มีส่วนที่หลอก"}
                    </span>
                  ) : null}
                  <span
                    className={`chip ${
                      h.wasCorrect
                        ? "bg-emerald-500/15 text-emerald-200"
                        : "bg-slate-500/20 text-slate-300"
                    }`}
                  >
                    {h.wasCorrect ? "ตอบถูก" : "ตอบผิด"}
                  </span>
                </div>

                <p className="text-sm leading-relaxed text-white">
                  &ldquo;{h.aiGeneratedText}&rdquo;
                </p>

                {note?.text ? (
                  <p className="mt-2 rounded-lg bg-black/25 px-3 py-2 text-xs leading-relaxed text-slate-300">
                    <b className="text-slate-100">ทำไมถึงใบ้แบบนี้:</b> {note.text}
                  </p>
                ) : null}
              </article>
            );
          })
        )}
      </section>

      {/* ไทม์ไลน์รายข้อ */}
      <section className="panel space-y-2 p-5">
        <h2 className="text-base font-bold text-white">ไทม์ไลน์รายข้อ</h2>
        <ol className="space-y-2 text-sm">
          {state.roundLog.map((r, i) => (
            <li
              key={`${r.questionId}-${i}`}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-white/5 pb-2 last:border-0"
            >
              <span className="tabular w-6 shrink-0 text-slate-500">{i + 1}.</span>
              <span className="text-[11px] text-slate-500">{STAGE_LABEL[r.stage]}</span>
              <span className="flex-1 basis-full text-slate-300 sm:basis-auto">
                {r.prompt}
              </span>
              <span
                className={`tabular shrink-0 font-bold ${
                  r.pointsDelta > 0
                    ? "text-emerald-300"
                    : r.pointsDelta < 0
                      ? "text-rose-300"
                      : "text-slate-500"
                }`}
              >
                {nameOf(state, r.answeringPlayer)} {r.pointsDelta > 0 ? "+" : ""}
                {r.pointsDelta}
              </span>
              {r.stealPlayer && (r.stealPoints ?? 0) > 0 ? (
                <span className="tabular shrink-0 font-bold text-cyan-300">
                  {nameOf(state, r.stealPlayer)} +{r.stealPoints}
                </span>
              ) : null}
            </li>
          ))}
          {state.finalResult ? (
            <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 pt-1">
              <span className="tabular w-6 shrink-0 text-slate-500">
                {state.roundLog.length + 1}.
              </span>
              <span className="text-[11px] text-amber-300">{STAGE_LABEL.final}</span>
              <span className="flex-1 basis-full text-slate-300 sm:basis-auto">
                {state.finalResult.prompt}
              </span>
              <span className="tabular shrink-0 font-bold text-fuchsia-300">
                {state.player1Name} +{state.finalResult.player1Points}
              </span>
              <span className="tabular shrink-0 font-bold text-cyan-300">
                {state.player2Name} +{state.finalResult.player2Points}
              </span>
            </li>
          ) : null}
        </ol>
      </section>

      <button
        onClick={() => dispatch({ type: "RESET" })}
        className="btn-primary w-full py-4 text-lg"
      >
        เล่นใหม่
      </button>

      <p className="pb-4 text-center text-[11px] leading-relaxed text-slate-500">
        คำใบ้ทั้งหมดในเกมนี้สร้างขึ้นเพื่อความบันเทิงและฝึกการคิดวิเคราะห์
        ส่วนที่ถูกออกแบบให้หลอกเป็นเรื่องแต่ง ห้ามนำไปใช้อ้างอิงจริง
      </p>
    </div>
  );
}
