"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ScoreBoard from "./ScoreBoard";
import TimerRing from "./TimerRing";
import { nameOf, useGame } from "@/lib/gameStore";
import { FINAL_SECONDS, STAGE_LABEL } from "@/lib/scoring";
import { useCountdown } from "@/lib/useCountdown";
import type {
  HintApiResponse,
  PlayerId,
  PublicHint,
  RevealApiResponse,
  RevealedHint,
} from "@/lib/types";

type Stage = "loading" | "error" | "locking" | "revealed";

export default function FinalDuelScreen() {
  const { state, dispatch } = useGame();
  const question = state.finalQuestion;

  const [stage, setStage] = useState<Stage>("loading");
  const [hints, setHints] = useState<PublicHint[]>([]);
  const [revealToken, setRevealToken] = useState<string | null>(null);
  const [source, setSource] = useState<"claude" | "fallback">("claude");
  const [revealedHints, setRevealedHints] = useState<RevealedHint[] | null>(null);

  const [p1Choice, setP1Choice] = useState<string | null>(null);
  const [p2Choice, setP2Choice] = useState<string | null>(null);
  const [p1Locked, setP1Locked] = useState(false);
  const [p2Locked, setP2Locked] = useState(false);
  /** ผู้เล่นแต่ละคน "เชื่อ" คำใบ้ชุดไหน (ไม่บังคับ) */
  const [p1Trust, setP1Trust] = useState<string | null>(null);
  const [p2Trust, setP2Trust] = useState<string | null>(null);

  const resolvedRef = useRef(false);
  // กัน React StrictMode (dev) ยิง /api/hint ซ้ำสองรอบ
  const fetchedRef = useRef(false);
  const stateRef = useRef({ p1Choice, p2Choice, revealToken, hints, p1Trust, p2Trust });
  stateRef.current = { p1Choice, p2Choice, revealToken, hints, p1Trust, p2Trust };

  const finishDuel = useCallback(() => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;

    const snap = stateRef.current;
    const hintsUsed: Array<{
      player: PlayerId;
      text: string;
      revealToken: string;
      hintId: string;
    }> = [];

    if (snap.revealToken) {
      const push = (player: PlayerId, hintId: string | null) => {
        const found = snap.hints.find((h) => h.id === hintId);
        if (found) {
          hintsUsed.push({
            player,
            text: found.text,
            revealToken: snap.revealToken as string,
            hintId: found.id,
          });
        }
      };
      push(1, snap.p1Trust);
      push(2, snap.p2Trust);
    }

    dispatch({
      type: "RESOLVE_FINAL",
      payload: {
        player1Choice: snap.p1Choice,
        player2Choice: snap.p2Choice,
        revealToken: snap.revealToken,
        hintsUsed,
      },
    });
    setStage("revealed");
  }, [dispatch]);

  const timer = useCountdown(finishDuel);
  const { start: startTimer, stop: stopTimer } = timer;

  // โหลดคำใบ้ 3 ชุดพร้อมกัน
  // หมายเหตุ: ใช้ fetchedRef กันยิงซ้ำ (StrictMode ใน dev รัน effect สองรอบ)
  // และตั้งใจ "ไม่" ใช้ธง cancelled ในคลีนอัป เพราะรอบแรกที่ยิงจริงจะถูกยกเลิกทิ้ง
  // ทั้งที่รอบสองไม่ได้ยิงใหม่ ทำให้ค้างหน้าโหลดถาวร
  useEffect(() => {
    if (!question || fetchedRef.current) return;
    fetchedRef.current = true;

    (async () => {
      try {
        const res = await fetch("/api/hint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId: question.id,
            correctAnswer: question.correctAnswer,
            hintType: "final",
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as HintApiResponse;
        setHints(data.hints);
        setRevealToken(data.revealToken);
        setSource(data.source);
        setStage("locking");
        startTimer(FINAL_SECONDS * 1000);
      } catch {
        setStage("error");
      }
    })();
  }, [question, startTimer]);

  // ทั้งคู่ล็อกครบ → เฉลยทันที (คำตอบยังถูกซ่อนจากกันตลอด จึงยังยุติธรรม)
  useEffect(() => {
    if (stage === "locking" && p1Locked && p2Locked) {
      stopTimer();
      finishDuel();
    }
  }, [stage, p1Locked, p2Locked, stopTimer, finishDuel]);

  // ดึงเฉลยว่าคำใบ้ชุดไหนจริง/หลอก
  useEffect(() => {
    if (stage !== "revealed" || !revealToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/reveal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revealToken }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as RevealApiResponse;
        if (!cancelled) setRevealedHints(data.hints);
      } catch {
        /* ไม่เป็นไร */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stage, revealToken]);

  if (!question) return null;

  const hintLabel = (index: number) => `คำใบ้ ${["A", "B", "C"][index] ?? index + 1}`;

  // เขียนเป็นฟังก์ชัน render (ไม่ใช่คอมโพเนนต์ซ้อน) เพื่อไม่ให้ DOM ถูก unmount ทุกครั้งที่ re-render
  function renderPlayerPanel(player: PlayerId, choices: string[]) {
    const isOne = player === 1;
    const choice = isOne ? p1Choice : p2Choice;
    const locked = isOne ? p1Locked : p2Locked;
    const trust = isOne ? p1Trust : p2Trust;
    const setChoice = isOne ? setP1Choice : setP2Choice;
    const setLocked = isOne ? setP1Locked : setP2Locked;
    const setTrust = isOne ? setP1Trust : setP2Trust;

    return (
      <div
        key={player}
        className={`panel space-y-3 p-4 ${
          locked
            ? "border-emerald-400/50 bg-emerald-500/[0.07]"
            : isOne
              ? "border-fuchsia-400/40"
              : "border-cyan-400/40"
        }`}
      >
        <div className="flex items-center justify-between">
          <h3
            className={`text-base font-bold ${
              isOne ? "text-fuchsia-200" : "text-cyan-200"
            }`}
          >
            {nameOf(state, player)}
          </h3>
          {locked ? (
            <span className="chip bg-emerald-500/20 text-emerald-200">🔒 ล็อกแล้ว</span>
          ) : (
            <span className="chip bg-white/10 text-slate-400">ยังไม่ล็อก</span>
          )}
        </div>

        {locked ? (
          <p className="rounded-lg bg-white/[0.05] px-3 py-6 text-center text-sm text-slate-400">
            คำตอบถูกซ่อนไว้จนกว่าจะเฉลยพร้อมกัน
          </p>
        ) : (
          <>
            <div className="grid gap-2">
              {choices.map((c) => (
                <button
                  key={c}
                  onClick={() => setChoice(c)}
                  className="choice py-2.5 text-sm"
                  style={
                    choice === c
                      ? {
                          borderColor: isOne ? "#e879f9" : "#22d3ee",
                          background: "rgba(255,255,255,0.12)",
                          boxShadow: `inset 0 0 0 1px ${isOne ? "#e879f9" : "#22d3ee"}`,
                        }
                      : undefined
                  }
                >
                  {c}
                </button>
              ))}
            </div>

            <div>
              <p className="mb-1.5 text-[11px] text-slate-400">
                เชื่อคำใบ้ชุดไหน? (ไม่บังคับ — ใช้ตอนสรุปผล)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {hints.map((h, i) => (
                  <button
                    key={h.id}
                    onClick={() => setTrust(trust === h.id ? null : h.id)}
                    className={`chip border transition ${
                      trust === h.id
                        ? "border-amber-300/70 bg-amber-400/20 text-amber-100"
                        : "border-stage-edge bg-white/5 text-slate-400 hover:bg-white/10"
                    }`}
                  >
                    {hintLabel(i)}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setLocked(true)}
              disabled={!choice}
              className="btn-primary w-full py-2.5 text-sm"
            >
              ล็อกคำตอบ
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ScoreBoard />

      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="chip bg-gradient-to-r from-fuchsia-500/30 to-cyan-500/30 text-white">
            {STAGE_LABEL.final}
          </span>
          <p className="mt-2 text-xs text-slate-400">
            ข้อสุดท้าย · <b className="text-amber-200">คะแนน 2 เท่า</b> ({question.pointValue}{" "}
            × 2) · คำใบ้ 3 ชุด จริงแค่ 1
          </p>
        </div>
        {stage === "locking" ? (
          <TimerRing remaining={timer.remaining} total={FINAL_SECONDS * 1000} label="ล็อกใน" />
        ) : null}
      </div>

      <div className="panel animate-popIn p-5">
        <h2 className="text-xl font-bold leading-relaxed sm:text-2xl">{question.prompt}</h2>
      </div>

      {stage === "loading" ? (
        <div className="panel flex flex-col items-center gap-3 p-10 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-white/15 border-t-fuchsia-400" />
          <p className="text-sm text-slate-300">AI กำลังร่างคำใบ้ 3 ชุดพร้อมกัน...</p>
          <p className="text-xs text-slate-500">จริง 1 ชุด หลอก 2 ชุด สลับตำแหน่งแบบสุ่ม</p>
        </div>
      ) : null}

      {stage === "error" ? (
        <div className="panel space-y-3 p-6 text-center">
          <p className="text-sm text-rose-200">
            สร้างคำใบ้รอบสุดท้ายไม่สำเร็จ — ลองใหม่อีกครั้งได้เลย
          </p>
          <button onClick={() => window.location.reload()} className="btn-ghost">
            โหลดใหม่
          </button>
        </div>
      ) : null}

      {stage !== "loading" && stage !== "error" ? (
        <>
          <div className="space-y-2.5">
            {hints.map((h, i) => {
              const revealedInfo = revealedHints?.find((r) => r.id === h.id);
              const isTrue = revealedInfo?.truth === "จริง";
              return (
                <div
                  key={h.id}
                  className={`animate-popIn rounded-2xl border p-4 transition-colors ${
                    revealedInfo
                      ? isTrue
                        ? "border-emerald-400/60 bg-emerald-500/10"
                        : "border-rose-400/50 bg-rose-500/[0.07]"
                      : "border-stage-edge bg-white/[0.04]"
                  }`}
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="chip bg-white/10 text-slate-200">{hintLabel(i)}</span>
                    {revealedInfo ? (
                      <span
                        className={`chip ${
                          isTrue
                            ? "bg-emerald-500/25 text-emerald-100"
                            : "bg-rose-500/25 text-rose-100"
                        }`}
                      >
                        {isTrue ? "✅ ชุดจริง" : "🎭 ชุดหลอก"}
                      </span>
                    ) : (
                      <span className="chip bg-white/5 text-slate-500">จริงหรือหลอก?</span>
                    )}
                    {source === "fallback" && i === 0 ? (
                      <span className="chip bg-amber-400/15 text-amber-200">โหมดสำรอง</span>
                    ) : null}
                  </div>
                  <p className="text-[15px] leading-relaxed text-white">{h.text}</p>
                  {revealedInfo ? (
                    <p className="mt-2 rounded-lg bg-black/25 px-3 py-2 text-xs leading-relaxed text-slate-300">
                      <b>ทำไมถึงใบ้แบบนี้:</b> {revealedInfo.rationale}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          {stage === "locking" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {renderPlayerPanel(1, question.choices)}
              {renderPlayerPanel(2, question.choices)}
            </div>
          ) : null}
        </>
      ) : null}

      {stage === "revealed" && state.finalResult ? (
        <div className="animate-popIn space-y-3">
          <div className="panel p-5">
            <p className="text-sm text-slate-300">
              คำตอบที่ถูกคือ{" "}
              <b className="text-white">{state.finalResult.correctAnswer}</b>
            </p>
            {question.explanation ? (
              <p className="mt-1 text-sm leading-relaxed text-slate-400">
                {question.explanation}
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {([1, 2] as PlayerId[]).map((player) => {
              const r = state.finalResult!;
              const choice = player === 1 ? r.player1Choice : r.player2Choice;
              const correct = player === 1 ? r.player1Correct : r.player2Correct;
              const points = player === 1 ? r.player1Points : r.player2Points;
              return (
                <div
                  key={player}
                  className={`rounded-2xl border p-4 ${
                    correct
                      ? "border-emerald-400/50 bg-emerald-500/10"
                      : "border-rose-400/40 bg-rose-500/[0.07]"
                  }`}
                >
                  <p className="text-sm font-semibold text-slate-200">
                    {nameOf(state, player)}
                  </p>
                  <p className="mt-1 text-sm text-white">
                    {choice ?? <span className="text-slate-500">ไม่ได้ล็อกคำตอบ</span>}
                  </p>
                  <p
                    className={`tabular mt-2 text-2xl font-extrabold ${
                      points > 0 ? "text-emerald-300" : "text-slate-400"
                    }`}
                  >
                    {points > 0 ? `+${points}` : "+0"}
                  </p>
                </div>
              );
            })}
          </div>

          <button
            onClick={() => dispatch({ type: "GO_DEBRIEF" })}
            className="btn-primary w-full py-4 text-lg"
          >
            ดูสรุปผล
          </button>
        </div>
      ) : null}
    </div>
  );
}
