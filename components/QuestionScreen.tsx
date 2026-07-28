"use client";

import { useEffect, useRef, useState } from "react";
import ScoreBoard from "./ScoreBoard";
import TimerRing from "./TimerRing";
import { nameOf, tokenOf, useGame } from "@/lib/gameStore";
import { useCountdown } from "@/lib/useCountdown";
import {
  ANSWER_SECONDS,
  MIN_SECONDS_AFTER_HINT,
  STAGE_LABEL,
  STEAL_SECONDS,
  activePlayerFor,
  opponentOf,
  scoreForAnswer,
  scoreForSteal,
} from "@/lib/scoring";
import type {
  HintApiResponse,
  HintType,
  RevealApiResponse,
  RevealedHint,
} from "@/lib/types";

type LocalPhase =
  | "prompt"
  | "answer"
  | "hintPick"
  | "hintLoading"
  | "hintAnswer"
  | "steal"
  | "result";

interface ActiveHint {
  text: string;
  revealToken: string;
  hintId: string;
  source: "claude" | "fallback";
}

interface Outcome {
  choice: string | null;
  correct: boolean;
  timedOut: boolean;
  delta: number;
}

interface StealOutcome {
  choice: string | null;
  correct: boolean;
  points: number;
}

export default function QuestionScreen() {
  const { state, dispatch } = useGame();
  const question = state.questions[state.currentQuestionIndex];

  const activePlayer = activePlayerFor(state.currentQuestionIndex);
  const stealPlayer = opponentOf(activePlayer);

  const [phase, setPhase] = useState<LocalPhase>("prompt");
  const [hintType, setHintType] = useState<HintType | null>(null);
  const [tokenSpent, setTokenSpent] = useState(false);
  const [hint, setHint] = useState<ActiveHint | null>(null);
  const [hintError, setHintError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [stealOutcome, setStealOutcome] = useState<StealOutcome | null>(null);
  const [revealed, setRevealed] = useState<RevealedHint | null>(null);

  const phaseRef = useRef<LocalPhase>(phase);
  phaseRef.current = phase;

  // กันกดซ้ำ/หมดเวลาชนกับการกดตอบ จนคิดคะแนนซ้ำ
  const answeredRef = useRef(false);
  const stolenRef = useRef(false);

  const nextButtonRef = useRef<HTMLButtonElement | null>(null);

  const timer = useCountdown(() => {
    const current = phaseRef.current;
    if (current === "steal") {
      submitSteal(null);
    } else if (
      current === "prompt" ||
      current === "answer" ||
      current === "hintPick" ||
      current === "hintAnswer"
    ) {
      submitAnswer(null, true);
    }
  });

  const { start: startTimer, stop: stopTimer, pause: pauseTimer, resume: resumeTimer } =
    timer;

  // รีเซ็ตทุกอย่างเมื่อเปลี่ยนข้อ
  useEffect(() => {
    answeredRef.current = false;
    stolenRef.current = false;
    setPhase("prompt");
    setHintType(null);
    setTokenSpent(false);
    setHint(null);
    setHintError(null);
    setOutcome(null);
    setStealOutcome(null);
    setRevealed(null);
    startTimer(ANSWER_SECONDS * 1000);
    return () => stopTimer();
  }, [state.currentQuestionIndex, startTimer, stopTimer]);

  // โฟกัสปุ่ม "ข้อถัดไป" ให้กด Enter ต่อได้ทันที
  useEffect(() => {
    if (phase === "result") nextButtonRef.current?.focus();
  }, [phase]);

  if (!question) return null;

  const activeTokens = tokenOf(state, activePlayer);
  const totalMain = state.questions.length;

  function submitAnswer(choice: string | null, timedOut: boolean) {
    if (answeredRef.current) return;
    answeredRef.current = true;
    stopTimer();
    const correct = !timedOut && choice === question.correctAnswer;
    const delta = scoreForAnswer({
      pointValue: question.pointValue,
      hintType,
      tokenSpent,
      correct,
    });

    dispatch({
      type: "RESOLVE_ROUND",
      payload: {
        answeredChoice: choice,
        hintType,
        tokenSpent,
        timedOut,
        hint: hint
          ? { text: hint.text, revealToken: hint.revealToken, hintId: hint.hintId }
          : undefined,
      },
    });

    setOutcome({ choice, correct, timedOut, delta });
    if (hint) void loadReveal(hint);

    if (correct) {
      setPhase("result");
    } else {
      setPhase("steal");
      startTimer(STEAL_SECONDS * 1000);
    }
  }

  function submitSteal(choice: string | null) {
    if (stolenRef.current) return;
    stolenRef.current = true;
    stopTimer();
    const correct = choice === question.correctAnswer;
    dispatch({ type: "RESOLVE_STEAL", payload: { stealChoice: choice } });
    setStealOutcome({
      choice,
      correct,
      points: scoreForSteal(question.pointValue, correct),
    });
    setPhase("result");
  }

  async function loadReveal(target: ActiveHint) {
    try {
      const res = await fetch("/api/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revealToken: target.revealToken }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as RevealApiResponse;
      setRevealed(data.hints.find((h) => h.id === target.hintId) ?? null);
    } catch {
      /* ไม่เป็นไร — แค่ไม่โชว์ป้ายเฉลยคำใบ้ */
    }
  }

  async function requestHint(type: HintType, useToken: boolean) {
    setHintType(type);
    setTokenSpent(type === "ตรง" && useToken);
    setHintError(null);
    setPhase("hintLoading");
    pauseTimer();

    try {
      const res = await fetch("/api/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: question.id,
          correctAnswer: question.correctAnswer,
          hintType: type,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as HintApiResponse;
      const first = data.hints[0];
      if (!first) throw new Error("empty");

      setHint({
        text: first.text,
        revealToken: data.revealToken,
        hintId: first.id,
        source: data.source,
      });
      setPhase("hintAnswer");
      resumeTimer(MIN_SECONDS_AFTER_HINT * 1000);
    } catch {
      // ขอคำใบ้ไม่สำเร็จ → ไม่คิดโทษผู้เล่น กลับไปตอบเองแบบไม่มีเงื่อนไข
      setHintType(null);
      setTokenSpent(false);
      setHintError("ขอคำใบ้ไม่สำเร็จ — เล่นต่อโดยไม่ใช้คำใบ้ได้เลย");
      setPhase("answer");
      resumeTimer(MIN_SECONDS_AFTER_HINT * 1000);
    }
  }

  const showTimer = phase !== "result" && phase !== "hintLoading";
  const timerTotal = phase === "steal" ? STEAL_SECONDS * 1000 : ANSWER_SECONDS * 1000;

  return (
    <div className="space-y-4">
      <ScoreBoard activePlayer={phase === "steal" ? stealPlayer : activePlayer} />

      {/* หัวข้อ / progress */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip bg-violet-500/20 text-violet-200">
              {STAGE_LABEL[question.stage]}
            </span>
            <span className="chip bg-white/10 text-slate-300">{question.category}</span>
            <span className="chip bg-amber-400/15 text-amber-200">
              {question.pointValue} คะแนน
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            ข้อ {state.currentQuestionIndex + 1} / {totalMain} ·{" "}
            <span className="font-semibold text-slate-200">
              {phase === "steal"
                ? `${nameOf(state, stealPlayer)} แย่งตอบ`
                : `ตาของ ${nameOf(state, activePlayer)}`}
            </span>
          </p>
        </div>
        {showTimer ? (
          <TimerRing
            remaining={timer.remaining}
            total={timerTotal}
            label={phase === "steal" ? "แย่งตอบ" : "เวลาตอบ"}
          />
        ) : (
          <TimerRing remaining={timer.remaining} total={timerTotal} paused label="พัก" />
        )}
      </div>

      {/* คำถาม */}
      <div className="panel animate-popIn p-5">
        <h2 className="text-xl font-bold leading-relaxed sm:text-2xl">{question.prompt}</h2>
      </div>

      {hintError ? (
        <p className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {hintError}
        </p>
      ) : null}

      {/* ── phase: prompt ─────────────────────────────────────────────── */}
      {phase === "prompt" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <button onClick={() => setPhase("answer")} className="btn-primary py-5 text-lg">
            ตอบเลย
          </button>
          <button onClick={() => setPhase("hintPick")} className="btn-cyan py-5 text-lg">
            ขอ AI ช่วย
          </button>
        </div>
      ) : null}

      {/* ── phase: hintPick ───────────────────────────────────────────── */}
      {phase === "hintPick" ? (
        <div className="space-y-3">
          <div className="panel space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-emerald-300">ใบ้ตรง</h3>
              <span className="chip bg-emerald-500/15 text-emerald-200">
                {tokenSpent ? "เต็ม 100%" : "ได้คะแนน 50%"}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-slate-300">
              เบาะแสจริงที่ตรวจสอบได้ ใกล้เคียงคำตอบแต่ไม่เฉลยตรง ๆ
              ถ้าตอบถูกหลังใบ้จะถูกหักคะแนนข้อนี้ครึ่งหนึ่ง
            </p>
            <label
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                activeTokens > 0
                  ? "cursor-pointer border-amber-400/40 bg-amber-400/10 text-amber-100"
                  : "border-stage-edge text-slate-500"
              }`}
            >
              <input
                type="checkbox"
                disabled={activeTokens === 0}
                checked={tokenSpent}
                onChange={(e) => setTokenSpent(e.target.checked)}
                className="h-4 w-4 accent-amber-400"
              />
              <span>
                ใช้โทเคนคำใบ้ 1 ชิ้น เพื่อไม่ให้ถูกหัก 50% (มีอยู่ {activeTokens} ชิ้น)
              </span>
            </label>
            <button
              onClick={() => requestHint("ตรง", tokenSpent)}
              className="btn-primary w-full"
            >
              ขอใบ้ตรง
            </button>
          </div>

          <div className="panel space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-rose-300">ใบ้ลวง</h3>
              <span className="chip bg-rose-500/15 text-rose-200">×2 / −×2</span>
            </div>
            <p className="text-sm leading-relaxed text-slate-300">
              ประโยคเดียวที่ผสมเบาะแสจริงกับเบาะแสที่แต่งขึ้น
              ไม่หักคะแนนตอนขอ แต่ตอบถูกได้ 2 เท่า ตอบผิดเสีย 2 เท่า
            </p>
            <button
              onClick={() => requestHint("ลวง", false)}
              className="btn w-full bg-gradient-to-r from-rose-600 to-orange-600 text-white
                         hover:from-rose-500 hover:to-orange-500"
            >
              ขอใบ้ลวง
            </button>
          </div>

          <button
            onClick={() => {
              setTokenSpent(false);
              setPhase("answer");
            }}
            className="btn-ghost w-full"
          >
            ไม่เอาแล้ว ตอบเอง
          </button>
        </div>
      ) : null}

      {/* ── phase: hintLoading ────────────────────────────────────────── */}
      {phase === "hintLoading" ? (
        <div className="panel flex flex-col items-center gap-3 p-8 text-center">
          <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-white/15 border-t-cyan-300" />
          <p className="text-sm text-slate-300">
            กำลังให้ AI ร่างคำใบ้{hintType ? `แบบ "ใบ้${hintType}"` : ""}...
          </p>
          <p className="text-xs text-slate-500">นาฬิกาหยุดชั่วคราวระหว่างรอ</p>
        </div>
      ) : null}

      {/* ── phase: answer / hintAnswer ────────────────────────────────── */}
      {phase === "answer" || phase === "hintAnswer" ? (
        <div className="space-y-3">
          {hint ? (
            <div
              className={`animate-popIn rounded-2xl border p-4 ${
                hintType === "ลวง"
                  ? "border-rose-400/40 bg-rose-500/10"
                  : "border-emerald-400/40 bg-emerald-500/10"
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="chip bg-white/10 text-slate-200">
                  คำใบ้จาก AI · โหมด &ldquo;ใบ้{hintType}&rdquo;
                </span>
                {hint.source === "fallback" ? (
                  <span className="chip bg-amber-400/15 text-amber-200">โหมดสำรอง</span>
                ) : null}
                {tokenSpent ? (
                  <span className="chip bg-amber-400/15 text-amber-200">
                    ใช้โทเคน · ไม่หักคะแนน
                  </span>
                ) : null}
              </div>
              <p className="text-base leading-relaxed text-white">{hint.text}</p>
              <p className="mt-2 text-[11px] text-slate-400">
                อย่าเพิ่งเชื่อทั้งหมด — ชั่งน้ำหนักกับสิ่งที่คุณรู้ก่อนตอบ
              </p>
            </div>
          ) : null}

          <div className="grid gap-2.5">
            {question.choices.map((choice) => (
              <button
                key={choice}
                onClick={() => submitAnswer(choice, false)}
                className="choice"
              >
                {choice}
              </button>
            ))}
          </div>

          {phase === "answer" && !hint ? (
            <button onClick={() => setPhase("hintPick")} className="btn-ghost w-full text-sm">
              เปลี่ยนใจ — ขอ AI ช่วย
            </button>
          ) : null}
        </div>
      ) : null}

      {/* ── phase: steal ──────────────────────────────────────────────── */}
      {phase === "steal" ? (
        <div className="space-y-3">
          <div className="animate-popIn rounded-2xl border border-amber-400/50 bg-amber-500/10 p-4 text-center">
            <p className="text-sm text-amber-100">
              {outcome?.timedOut ? "หมดเวลา!" : "ตอบผิด!"}{" "}
              <b className="text-white">{nameOf(state, stealPlayer)}</b> มีสิทธิ์แย่งตอบ
              — ตอบถูกได้ {question.pointValue} คะแนนเต็ม
            </p>
          </div>
          <div className="grid gap-2.5">
            {question.choices.map((choice) => (
              <button key={choice} onClick={() => submitSteal(choice)} className="choice">
                {choice}
              </button>
            ))}
          </div>
          <button onClick={() => submitSteal(null)} className="btn-ghost w-full text-sm">
            ขอผ่าน
          </button>
        </div>
      ) : null}

      {/* ── phase: result ─────────────────────────────────────────────── */}
      {phase === "result" && outcome ? (
        <div className="animate-popIn space-y-3">
          <div
            className={`rounded-2xl border p-5 ${
              outcome.correct
                ? "border-emerald-400/50 bg-emerald-500/10"
                : "border-rose-400/50 bg-rose-500/10"
            }`}
          >
            <p className="text-lg font-bold">
              {outcome.correct
                ? `✅ ${nameOf(state, activePlayer)} ตอบถูก`
                : outcome.timedOut
                  ? `⏱️ ${nameOf(state, activePlayer)} หมดเวลา`
                  : `❌ ${nameOf(state, activePlayer)} ตอบผิด`}
            </p>
            <p className="mt-1 text-sm text-slate-300">
              คำตอบที่ถูกคือ{" "}
              <b className="text-white">{question.correctAnswer}</b>
            </p>
            {question.explanation ? (
              <p className="mt-1 text-sm leading-relaxed text-slate-400">
                {question.explanation}
              </p>
            ) : null}
            <p
              className={`mt-3 tabular text-2xl font-extrabold ${
                outcome.delta > 0
                  ? "text-emerald-300"
                  : outcome.delta < 0
                    ? "text-rose-300"
                    : "text-slate-400"
              }`}
            >
              {outcome.delta > 0 ? "+" : ""}
              {outcome.delta} คะแนน
            </p>
          </div>

          {stealOutcome ? (
            <div
              className={`rounded-2xl border p-4 ${
                stealOutcome.correct
                  ? "border-cyan-400/50 bg-cyan-500/10"
                  : "border-stage-edge bg-white/[0.03]"
              }`}
            >
              <p className="text-sm">
                <b className="text-white">{nameOf(state, stealPlayer)}</b>{" "}
                {stealOutcome.choice === null
                  ? "ไม่ได้แย่งตอบ"
                  : stealOutcome.correct
                    ? "แย่งตอบถูก"
                    : "แย่งตอบผิด"}{" "}
                <span
                  className={`tabular font-bold ${
                    stealOutcome.points > 0 ? "text-cyan-300" : "text-slate-400"
                  }`}
                >
                  {stealOutcome.points > 0 ? `+${stealOutcome.points}` : "+0"} คะแนน
                </span>
              </p>
            </div>
          ) : null}

          {hint ? (
            <div className="panel space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-200">
                  เฉลยคำใบ้ที่ขอไป
                </span>
                {revealed ? (
                  <span
                    className={`chip ${
                      revealed.truth === "จริง"
                        ? "bg-emerald-500/20 text-emerald-200"
                        : "bg-rose-500/20 text-rose-200"
                    }`}
                  >
                    {revealed.truth === "จริง" ? "เบาะแสจริงล้วน" : "มีส่วนที่หลอกปน"}
                  </span>
                ) : (
                  <span className="chip bg-white/10 text-slate-400">กำลังเปิดเฉลย...</span>
                )}
              </div>
              <p className="text-sm leading-relaxed text-slate-300">
                &ldquo;{hint.text}&rdquo;
              </p>
              {revealed ? (
                <p className="rounded-lg bg-white/[0.04] px-3 py-2 text-xs leading-relaxed text-slate-400">
                  <b className="text-slate-300">ทำไมถึงใบ้แบบนี้:</b> {revealed.rationale}
                </p>
              ) : null}
            </div>
          ) : null}

          <button
            ref={nextButtonRef}
            onClick={() => dispatch({ type: "NEXT_QUESTION" })}
            className="btn-primary w-full py-4 text-lg"
          >
            {state.currentQuestionIndex + 1 >= totalMain
              ? "เข้าสู่ AI Duel Final"
              : "ข้อถัดไป"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
