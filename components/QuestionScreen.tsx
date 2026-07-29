"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ScoreBoard from "./ScoreBoard";
import TeammateNotes from "./TeammateNotes";
import TimerRing from "./TimerRing";
import { useGame } from "@/lib/gameStore";
import { useRoom } from "@/lib/roomClient";
import { botRemark, planBotTurn, type BotTurn } from "@/lib/bot";
import {
  STAGE_LABEL,
  activeParticipantIndex,
  hintMultiplier,
  nameOfId,
} from "@/lib/scoring";
import { useCountdown } from "@/lib/useCountdown";
import { llmRequestPayload } from "@/lib/settings";
import type {
  GradeApiResponse,
  HintApiResponse,
  HintBox,
  Participant,
  RevealApiResponse,
  RevealedHintBox,
} from "@/lib/types";

type Local =
  | "answering"
  | "performing"
  | "grading"
  | "rating"
  | "steal"
  | "result";

interface Outcome {
  answer: string | null;
  quality: number;
  timedOut: boolean;
  points: number;
  feedback?: string;
  strengths?: string[];
  improvements?: string[];
  botRemark?: string;
}

export default function QuestionScreen() {
  const { state, dispatch } = useGame();
  const { isHost, syncLive } = useRoom();
  const question = state.questions[state.currentQuestionIndex];
  const activeIndex = activeParticipantIndex(
    state.currentQuestionIndex,
    state.participants.length,
  );
  const active: Participant | undefined = state.participants[activeIndex];
  const others = state.participants.filter((p) => p.id !== active?.id);

  const [phase, setPhase] = useState<Local>("answering");
  const [boxes, setBoxes] = useState<HintBox[] | null>(null);
  const [revealToken, setRevealToken] = useState<string | null>(null);
  const [hintSource, setHintSource] = useState<"llm" | "fallback">("llm");
  const [hintFailed, setHintFailed] = useState(false);
  const [openedIds, setOpenedIds] = useState<string[]>([]);
  const [useToken, setUseToken] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [ratings, setRatings] = useState<number[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [revealed, setRevealed] = useState<RevealedHintBox[] | null>(null);
  const [stealerId, setStealerId] = useState<string | null>(null);
  const [stealResult, setStealResult] = useState<{ id: string; correct: boolean } | null>(
    null,
  );
  const [botTurn, setBotTurn] = useState<BotTurn | null>(null);

  const phaseRef = useRef<Local>(phase);
  phaseRef.current = phase;
  const textRef = useRef(text);
  textRef.current = text;
  const resolvedRef = useRef(false);
  const hintKeyRef = useRef<string | null>(null);
  const nextBtnRef = useRef<HTMLButtonElement | null>(null);

  const timer = useCountdown(() => {
    const p = phaseRef.current;
    if (p === "answering" || p === "performing") void finish(true);
    else if (p === "steal") endSteal(false);
  });
  const { start: startTimer, stop: stopTimer } = timer;

  const openedBoxes = (boxes ?? []).filter((b) => openedIds.includes(b.id));
  const tokenSpent = useToken && openedIds.length > 0;
  const paidBoxes = Math.max(0, openedIds.length - (tokenSpent ? 1 : 0));
  const isBotTurn = active?.kind === "bot";
  const cfg = state.settings;
  // เวลาและจำนวนกล่องที่เปิดได้ ต่างกันในแต่ละช่วง
  const stageSeconds = question ? cfg.seconds[question.stage] : 60;
  const maxOpen = question ? cfg.maxOpenBoxes[question.stage] : 1;
  const openLimitReached = openedIds.length >= maxOpen;

  // ── รีเซ็ตต่อข้อ + เริ่มนาฬิกา 60 วิ (ไม่มีการหยุดพักระหว่างข้อ) ──────────
  useEffect(() => {
    resolvedRef.current = false;
    setPhase(question?.format === "performance" ? "performing" : "answering");
    setOpenedIds([]);
    setUseToken(false);
    setChoice(null);
    setText("");
    setRatings([]);
    setOutcome(null);
    setRevealed(null);
    setStealerId(null);
    setStealResult(null);
    setBotTurn(null);
    setBoxes(null);
    setRevealToken(null);
    setHintFailed(false);
    startTimer(stageSeconds * 1000);
    return () => stopTimer();
  }, [state.currentQuestionIndex, question?.format, stageSeconds, startTimer, stopTimer]);

  // ── ส่งสถานะสดให้เพื่อนร่วมทีมที่ใช้เครื่องอื่น ──────────────────────────
  // นาฬิกากับกล่องคำใบ้เป็น state ในหน้านี้ ไม่ได้อยู่ใน reducer จึงต้องส่งแยก
  // ใช้ timer.deadlineAt ตรง ๆ เพราะเป็นเวลาปลายทางจริง ไม่เพี้ยนตามการหน่วง
  // ของแท็บ และเปลี่ยนแค่ตอนขึ้นข้อใหม่ จึงไม่ยิงเครือข่ายทุก tick
  useEffect(() => {
    if (!isHost) return;
    syncLive({
      questionId: question?.id ?? null,
      deadlineAt: timer.deadlineAt,
      boxes: (boxes ?? []).map((b) => ({
        id: b.id,
        label: b.label,
        text: openedIds.includes(b.id) ? b.text : null,
      })),
      activeParticipantId: active?.id ?? null,
      step: phase,
    });
  }, [
    isHost,
    syncLive,
    question?.id,
    timer.deadlineAt,
    boxes,
    openedIds,
    active?.id,
    phase,
  ]);

  // ── โหลดกล่องคำใบ้ล่วงหน้าตั้งแต่ข้อเริ่ม เพื่อให้กดเปิดได้ทันที ──────────
  useEffect(() => {
    if (!question) return;
    const key = `${state.currentQuestionIndex}-${question.id}`;
    if (hintKeyRef.current === key) return;
    hintKeyRef.current = key;

    (async () => {
      try {
        const res = await fetch("/api/hint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // ส่งตัวข้อไปด้วย เผื่อเป็นคำถามที่แก้/เพิ่มจากหลังบ้าน
          // ซึ่งเซิร์ฟเวอร์ไม่มีอยู่ในคลังตั้งต้น
          body: JSON.stringify({
            questionId: question.id,
            question,
            llm: llmRequestPayload(),
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as HintApiResponse;
        setBoxes(data.boxes);
        setRevealToken(data.revealToken);
        setHintSource(data.source);
      } catch {
        setHintFailed(true);
      }
    })();
  }, [question, state.currentQuestionIndex]);

  // ── โฟกัสปุ่มถัดไป ───────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === "result") nextBtnRef.current?.focus();
  }, [phase]);

  const loadReveal = useCallback(async (token: string) => {
    try {
      const res = await fetch("/api/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revealToken: token }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as RevealApiResponse;
      setRevealed(data.boxes);
    } catch {
      /* ไม่เป็นไร */
    }
  }, []);

  // ── จบข้อ ────────────────────────────────────────────────────────────────
  const commit = useCallback(
    (opts: {
      answer: string | null;
      quality: number;
      timedOut: boolean;
      feedback?: string;
      strengths?: string[];
      improvements?: string[];
      remark?: string;
      /**
       * เทิร์นบอทเปิดกล่องแล้ว commit ในจังหวะเดียวกัน state จึงยังไม่อัปเดต
       * ต้องส่งกล่องที่เปิดเข้ามาตรง ๆ ไม่งั้นบอทจะได้คำใบ้ฟรีโดยไม่ถูกหักคะแนน
       */
      boxesOverride?: HintBox[];
    }) => {
      if (!question || !active) return;
      stopTimer();

      const usedBoxes = opts.boxesOverride ?? openedBoxes;
      const usedCount = usedBoxes.length;
      const usedPaid = opts.boxesOverride
        ? usedCount
        : paidBoxes;

      const points = (() => {
        if (opts.timedOut || opts.quality <= 0) return 0;
        return Math.max(
          0,
          Math.round(
            question.pointValue *
              hintMultiplier(usedPaid, cfg.boxCostRatio) *
              (opts.quality / 100),
          ),
        );
      })();

      dispatch({
        type: "RESOLVE_ROUND",
        payload: {
          participantId: active.id,
          answer: opts.answer,
          quality: opts.quality,
          boxesOpened: usedCount,
          tokenSpent: opts.boxesOverride ? false : tokenSpent,
          timedOut: opts.timedOut,
          feedback: opts.feedback,
          openedBoxes:
            revealToken && usedBoxes.length > 0
              ? usedBoxes.map((b) => ({
                  boxId: b.id,
                  boxLabel: b.label,
                  text: b.text,
                  revealToken,
                }))
              : undefined,
        },
      });

      setOutcome({
        answer: opts.answer,
        quality: opts.quality,
        timedOut: opts.timedOut,
        points,
        feedback: opts.feedback,
        strengths: opts.strengths,
        improvements: opts.improvements,
        botRemark: opts.remark,
      });
      if (revealToken) void loadReveal(revealToken);

      // แย่งตอบได้เฉพาะปรนัย และต้องยังมีเวลาเหลือในข้อนั้น
      const canSteal =
        question.format === "choice" &&
        others.length > 0 &&
        opts.quality < 60 &&
        timer.remaining > 1500;

      if (canSteal) {
        setPhase("steal");
        startTimer(timer.remaining);
      } else {
        setPhase("result");
      }
    },
    [
      question,
      active,
      others.length,
      openedIds.length,
      openedBoxes,
      paidBoxes,
      tokenSpent,
      revealToken,
      cfg.boxCostRatio,
      dispatch,
      loadReveal,
      startTimer,
      stopTimer,
      timer.remaining,
    ],
  );

  const finish = useCallback(
    // picked ส่งตรงมาจากปุ่มที่กด — อ่านจาก state ไม่ได้เพราะ React ยังไม่ re-render
    // ทำให้ finish() ที่ถูกสร้างไว้รอบก่อนยังเห็น choice เป็นค่าเดิม
    async (timedOut: boolean, picked?: string | null) => {
      if (resolvedRef.current || !question) return;
      resolvedRef.current = true;

      if (question.format === "choice") {
        const answer = picked !== undefined ? picked : choice;
        commit({
          answer,
          quality: answer && answer === question.correctAnswer ? 100 : 0,
          timedOut: timedOut && !answer,
        });
        return;
      }

      if (question.format === "open") {
        const answer = textRef.current.trim();
        if (!answer) {
          commit({ answer: null, quality: 0, timedOut: true });
          return;
        }
        stopTimer();
        setPhase("grading");
        try {
          const res = await fetch("/api/grade", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              questionId: question.id,
              question,
              answer,
              llm: llmRequestPayload(),
            }),
          });
          const data = (await res.json()) as GradeApiResponse;
          commit({
            answer,
            quality: data.score,
            timedOut: false,
            feedback: data.feedback,
            strengths: data.strengths,
            improvements: data.improvements,
          });
        } catch {
          commit({
            answer,
            quality: 0,
            timedOut: false,
            feedback: "ตรวจคำตอบไม่สำเร็จ — ข้อนี้ยังไม่ได้คะแนน",
          });
        }
        return;
      }

      // performance → ไปหน้าให้ดาว (ไม่จับเวลาช่วงให้คะแนน)
      stopTimer();
      resolvedRef.current = false;
      setRatings(Array((others.length || 1) as number).fill(0));
      setPhase("rating");
    },
    [question, choice, commit, others.length, stopTimer],
  );

  function submitRatings() {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    const valid = ratings.filter((r) => r > 0);
    const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
    commit({
      answer: "แสดงสด",
      quality: Math.round((avg / 5) * 100),
      timedOut: false,
      feedback: valid.length ? `คะแนนเฉลี่ย ${avg.toFixed(1)} / 5 ดาว` : "ไม่มีใครให้คะแนน",
    });
  }

  function endSteal(correct: boolean) {
    stopTimer();
    if (stealerId) {
      dispatch({ type: "RESOLVE_STEAL", participantId: stealerId, correct });
      setStealResult({ id: stealerId, correct });
    }
    setPhase("result");
  }

  function openBox(id: string) {
    if (openedIds.includes(id)) return;
    setOpenedIds((prev) => [...prev, id]);
  }

  // ── เทิร์นของบอท ─────────────────────────────────────────────────────────
  useEffect(() => {
    // ครอบคลุม "performing" ด้วย ไม่งั้นข้อโชว์ความสามารถของบอทจะค้าง
    // แล้วเด้งไปให้คนจริงกดดาวให้การแสดงที่ไม่เคยเกิดขึ้น
    if (!isBotTurn || !question || (phase !== "answering" && phase !== "performing")) return;
    const plan = planBotTurn(question, "ปกติ");
    setBotTurn(plan);
    const delay = Math.min(plan.thinkSeconds, Math.max(3, stageSeconds - 4)) * 1000;
    const id = window.setTimeout(() => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      // บอทก็ติดโควตาการเปิดกล่องของช่วงนั้นเหมือนคนจริง
      const botBoxes = boxes ? boxes.slice(0, Math.min(plan.boxesOpened, maxOpen)) : [];
      if (botBoxes.length > 0) setOpenedIds(botBoxes.map((b) => b.id));
      commit({
        answer: plan.choice ?? "(บอทตอบ)",
        quality: plan.quality,
        timedOut: false,
        remark: botRemark({ ...plan, boxesOpened: botBoxes.length }, "ปกติ"),
        boxesOverride: botBoxes,
      });
    }, delay);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBotTurn, state.currentQuestionIndex, phase, boxes]);

  if (!question || !active) return null;

  const totalQuestions = state.questions.length;
  const isLast = state.currentQuestionIndex + 1 >= totalQuestions;
  const remainingPct = Math.round(hintMultiplier(paidBoxes, cfg.boxCostRatio) * 100);
  const formatLabel =
    question.format === "choice"
      ? "ปรนัย"
      : question.format === "open"
        ? "อัตนัย · พิมพ์ตอบ"
        : "โชว์ความสามารถ";

  return (
    <div className="space-y-4">
      <ScoreBoard activeId={phase === "steal" ? stealerId : active.id} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="chip bg-indigo-500/20 text-indigo-200">
              {STAGE_LABEL[question.stage]}
            </span>
            <span className="chip bg-white/10 text-slate-300">{question.category}</span>
            <span className="chip bg-sky-500/15 text-sky-200">{formatLabel}</span>
            <span className="chip bg-teal-400/15 text-teal-200">{question.difficulty}</span>
            <span className="chip bg-cyan-400/15 text-cyan-100">
              {question.pointValue} คะแนน
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            ข้อ {state.currentQuestionIndex + 1} / {totalQuestions} ·{" "}
            <span className="font-semibold text-slate-200">
              {phase === "steal" && stealerId
                ? `${nameOfId(state.participants, stealerId)} แย่งตอบ`
                : `ตาของ ${active.name}`}
            </span>
          </p>
        </div>
        <TimerRing
          remaining={timer.remaining}
          total={stageSeconds * 1000}
          label={phase === "steal" ? "แย่งตอบ" : "เวลาที่เหลือ"}
          paused={phase === "grading" || phase === "rating" || phase === "result"}
        />
      </div>

      <div className="panel animate-popIn p-5">
        <h2 className="text-xl font-bold leading-relaxed sm:text-2xl">{question.prompt}</h2>
        {question.task ? (
          <p className="mt-3 whitespace-pre-line rounded-xl bg-white/[0.05] p-3 text-sm leading-relaxed text-slate-300">
            {question.task}
          </p>
        ) : null}
      </div>

      {/* ── กล่องคำใบ้ 4 กล่อง ─────────────────────────────────────────── */}
      {(phase === "answering" || phase === "performing") && !isBotTurn ? (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-200">
              กล่องคำใบ้ {cfg.boxCount} กล่อง ·{" "}
              <span className={openLimitReached ? "text-cyan-200" : ""}>
                ช่วงนี้เปิดได้ {maxOpen} กล่อง (เปิดแล้ว {openedIds.length})
              </span>
            </h3>
            <span
              className={`chip ${
                remainingPct === 100
                  ? "bg-teal-400/15 text-teal-200"
                  : remainingPct > 0
                    ? "bg-sky-500/15 text-sky-200"
                    : "bg-rose-500/20 text-rose-200"
              }`}
            >
              เหลือ {remainingPct}% ของคะแนนข้อนี้
            </span>
          </div>

          {active.tokens > 0 ? (
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-cyan-300/40 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100">
              <input
                type="checkbox"
                checked={useToken}
                onChange={(e) => setUseToken(e.target.checked)}
                className="h-4 w-4 accent-cyan-400"
              />
              ใช้โทเคน 1 ชิ้น — กล่องแรกที่เปิดไม่หักคะแนน (มี {active.tokens} ชิ้น)
            </label>
          ) : null}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(boxes ?? Array.from({ length: cfg.boxCount })).map((box, i) => {
              const b = box as HintBox | undefined;
              const opened = b ? openedIds.includes(b.id) : false;
              if (opened && b) {
                return (
                  <div
                    key={b.id}
                    className="animate-popIn rounded-2xl border border-sky-400/50 bg-sky-500/10 p-3"
                  >
                    <span className="chip bg-white/10 px-2 py-0.5 text-[10px] text-slate-200">
                      กล่อง {b.label}
                    </span>
                    <p className="mt-1.5 text-xs leading-relaxed text-white">{b.text}</p>
                  </div>
                );
              }
              return (
                <button
                  key={b?.id ?? i}
                  onClick={() => b && openBox(b.id)}
                  disabled={!b || openLimitReached}
                  className="hint-box"
                >
                  <span className="text-2xl" aria-hidden="true">
                    {!b ? "⏳" : openLimitReached ? "🔒" : "🎁"}
                  </span>
                  <span className="text-xs font-bold text-sky-100">
                    {b ? `กล่อง ${b.label}` : "กำลังเตรียม"}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {!b ? "" : openLimitReached ? "ครบโควตาแล้ว" : `−${Math.round(cfg.boxCostRatio * 100)}%`}
                  </span>
                </button>
              );
            })}
          </div>

          {hintFailed ? (
            <p className="text-[11px] text-rose-300">
              เตรียมกล่องคำใบ้ไม่สำเร็จ — ข้อนี้เล่นต่อได้โดยไม่มีคำใบ้
            </p>
          ) : hintSource === "fallback" && boxes ? (
            <p className="text-[11px] text-cyan-200/70">
              โหมดสำรอง — ยังต่อโมเดลไม่ได้ (เช็กที่หลังบ้าน → แท็บ API)
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ── คำใบ้ที่เปิดไว้ — ค้างบนจอจนจบข้อ ──────────────────────────────
          ผู้เล่นจ่ายคะแนนไปแล้วเพื่อเปิดกล่องนี้ ถ้ามันหายไปตอนกดตอบ
          ก็เท่ากับจ่ายแล้วอ่านไม่ทัน ตรงนี้จึงต้องอยู่ต่อจนกว่าจะขึ้นเฉลย
          (ตอนกำลังตอบอยู่ กริดด้านบนแสดงให้แล้ว ไม่ต้องซ้ำ) */}
      {openedBoxes.length > 0 &&
      phase !== "answering" &&
      phase !== "performing" &&
      !(phase === "result" && revealed) ? (
        <section className="space-y-2">
          <h3 className="text-sm font-bold text-slate-200">คำใบ้ที่เปิดไว้</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {openedBoxes.map((b) => (
              <div
                key={b.id}
                className="rounded-2xl border border-sky-400/50 bg-sky-500/10 p-3"
              >
                <span className="chip bg-white/10 px-2 py-0.5 text-[10px] text-slate-200">
                  กล่อง {b.label}
                </span>
                <p className="mt-1.5 text-xs leading-relaxed text-white">{b.text}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── ข้อเสนอจากเพื่อนร่วมทีมที่ใช้อีกเครื่อง ─────────────────────── */}
      {phase === "answering" || phase === "performing" ? (
        <TeammateNotes questionId={question.id} />
      ) : null}

      {/* ── บอทกำลังคิด ─────────────────────────────────────────────────── */}
      {isBotTurn && (phase === "answering" || phase === "performing") ? (
        <div className="panel flex flex-col items-center gap-2 p-8 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/15 border-t-teal-300" />
          <p className="text-sm text-slate-300">
            🤖 {active.name} {question.format === "performance" ? "กำลังโชว์" : "กำลังคิด"}...
          </p>
          <p className="text-[11px] text-slate-500">
            บอทอาจเปิดกล่องคำใบ้ และก็โดนใบ้หลอกได้เหมือนกัน
          </p>
        </div>
      ) : null}

      {/* ── ปรนัย ───────────────────────────────────────────────────────── */}
      {phase === "answering" && !isBotTurn && question.format === "choice" ? (
        <div className="grid gap-2.5">
          {(question.choices ?? []).map((c) => (
            <button
              key={c}
              onClick={() => {
                setChoice(c);
                void finish(false, c);
              }}
              className="choice"
            >
              {c}
            </button>
          ))}
        </div>
      ) : null}

      {/* ── อัตนัย ──────────────────────────────────────────────────────── */}
      {phase === "answering" && !isBotTurn && question.format === "open" ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            maxLength={1200}
            placeholder="พิมพ์คำตอบของคุณ... (AI จะตรวจตามเกณฑ์ของข้อนี้)"
            className="field min-h-[130px] resize-y leading-relaxed"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500">{text.length}/1200</span>
            <button
              onClick={() => void finish(false)}
              disabled={!text.trim()}
              className="btn-primary px-6 py-2.5 text-sm"
            >
              ส่งคำตอบ
            </button>
          </div>
        </div>
      ) : null}

      {/* ── โชว์ความสามารถ ──────────────────────────────────────────────── */}
      {phase === "performing" && !isBotTurn ? (
        <div className="panel space-y-3 p-5 text-center">
          <p className="text-sm text-slate-300">
            เริ่มแสดงได้เลย — จับเวลาอยู่ พอจบแล้วกดปุ่มด้านล่างเพื่อให้กรรมการให้คะแนน
          </p>
          <button onClick={() => void finish(false)} className="btn-teal w-full py-4 text-lg">
            จบการแสดง → ให้คะแนน
          </button>
        </div>
      ) : null}

      {/* ── ให้ดาว ──────────────────────────────────────────────────────── */}
      {phase === "rating" ? (
        <div className="panel space-y-4 p-5">
          <h3 className="text-base font-bold text-white">กรรมการให้คะแนน</h3>
          <p className="text-xs text-slate-400">
            {others.length > 0
              ? "ให้แต่ละฝ่ายกดดาว 1–5 ตามเกณฑ์ด้านล่าง"
              : "โหมดเล่นคนเดียว — ประเมินตัวเองตามตรง"}
          </p>
          {question.rubric ? (
            <p className="rounded-lg bg-white/[0.05] px-3 py-2 text-xs leading-relaxed text-slate-300">
              <b className="text-slate-200">เกณฑ์:</b> {question.rubric}
            </p>
          ) : null}

          <div className="space-y-2.5">
            {(others.length > 0 ? others : [active]).map((rater, i) => (
              <div key={rater.id} className="flex items-center justify-between gap-3">
                <span className="truncate text-sm text-slate-200">
                  {others.length > 0 ? rater.name : "ประเมินตัวเอง"}
                </span>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() =>
                        setRatings((prev) => {
                          const next = [...prev];
                          next[i] = star;
                          return next;
                        })
                      }
                      aria-label={`${rater.name} ให้ ${star} ดาว`}
                      className={`h-9 w-9 rounded-lg border text-lg transition ${
                        (ratings[i] ?? 0) >= star
                          ? "border-cyan-300/70 bg-cyan-400/20"
                          : "border-stage-edge bg-white/[0.03] hover:bg-white/[0.08]"
                      }`}
                    >
                      {(ratings[i] ?? 0) >= star ? "★" : "☆"}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={submitRatings}
            disabled={!ratings.some((r) => r > 0)}
            className="btn-primary w-full"
          >
            ยืนยันคะแนน
          </button>
        </div>
      ) : null}

      {/* ── กำลังตรวจ ───────────────────────────────────────────────────── */}
      {phase === "grading" ? (
        <div className="panel flex flex-col items-center gap-3 p-8 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/15 border-t-sky-300" />
          <p className="text-sm text-slate-300">AI กำลังตรวจคำตอบตามเกณฑ์ของข้อนี้...</p>
        </div>
      ) : null}

      {/* ── แย่งตอบ ─────────────────────────────────────────────────────── */}
      {phase === "steal" ? (
        <div className="space-y-3">
          <div className="animate-popIn rounded-2xl border border-cyan-300/50 bg-cyan-400/10 p-4 text-center text-sm text-cyan-50">
            {outcome?.timedOut ? "หมดเวลา!" : "ตอบผิด!"} ใครแย่งตอบได้บ้าง —
            ใช้เวลาที่เหลือของข้อนี้
          </div>
          {!stealerId ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {others.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setStealerId(p.id)}
                  className="btn-ghost w-full"
                >
                  {p.kind === "bot" ? "🤖 " : ""}
                  {p.name} ขอแย่งตอบ
                </button>
              ))}
            </div>
          ) : (
            <div className="grid gap-2.5">
              {(question.choices ?? []).map((c) => (
                <button
                  key={c}
                  onClick={() => endSteal(c === question.correctAnswer)}
                  className="choice"
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          <button onClick={() => endSteal(false)} className="btn-ghost w-full text-sm">
            ไม่มีใครแย่ง — ข้ามไป
          </button>
        </div>
      ) : null}

      {/* ── ผลลัพธ์ ─────────────────────────────────────────────────────── */}
      {phase === "result" && outcome ? (
        <div className="animate-popIn space-y-3">
          <div
            className={`rounded-2xl border p-5 ${
              outcome.points > 0
                ? "border-teal-300/50 bg-teal-400/10"
                : "border-rose-400/50 bg-rose-500/10"
            }`}
          >
            <p className="text-lg font-bold">
              {outcome.timedOut
                ? `⏱️ ${active.name} หมดเวลา`
                : outcome.points > 0
                  ? `✅ ${active.name} ได้คะแนน`
                  : `❌ ${active.name} ไม่ได้คะแนนข้อนี้`}
            </p>

            {question.format === "choice" && question.correctAnswer ? (
              <p className="mt-1 text-sm text-slate-300">
                คำตอบที่ถูกคือ <b className="text-white">{question.correctAnswer}</b>
              </p>
            ) : null}
            {outcome.feedback ? (
              <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
                {outcome.feedback}
              </p>
            ) : null}
            {outcome.botRemark ? (
              <p className="mt-1 text-sm text-slate-400">🤖 {outcome.botRemark}</p>
            ) : null}

            {outcome.strengths?.length ? (
              <ul className="mt-2 space-y-1 text-xs text-teal-200">
                {outcome.strengths.map((s, i) => (
                  <li key={i}>✔ {s}</li>
                ))}
              </ul>
            ) : null}
            {outcome.improvements?.length ? (
              <ul className="mt-1 space-y-1 text-xs text-sky-200/80">
                {outcome.improvements.map((s, i) => (
                  <li key={i}>↗ {s}</li>
                ))}
              </ul>
            ) : null}

            {question.explanation ? (
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                {question.explanation}
              </p>
            ) : null}

            <div className="mt-3 flex items-baseline gap-3">
              <span
                className={`tabular text-2xl font-extrabold ${
                  outcome.points > 0 ? "text-teal-300" : "text-slate-400"
                }`}
              >
                +{outcome.points}
              </span>
              {openedIds.length > 0 ? (
                <span className="text-xs text-slate-500">
                  (คุณภาพคำตอบ {outcome.quality}% · เปิด {openedIds.length} กล่อง
                  {tokenSpent ? " · ใช้โทเคน 1" : ""} → เหลือ {remainingPct}%)
                </span>
              ) : (
                <span className="text-xs text-slate-500">
                  (คุณภาพคำตอบ {outcome.quality}%)
                </span>
              )}
            </div>
          </div>

          {stealResult ? (
            <div
              className={`rounded-2xl border p-4 text-sm ${
                stealResult.correct
                  ? "border-cyan-300/50 bg-cyan-400/10"
                  : "border-stage-edge bg-white/[0.03]"
              }`}
            >
              <b className="text-white">{nameOfId(state.participants, stealResult.id)}</b>{" "}
              {stealResult.correct ? "แย่งตอบถูก" : "แย่งตอบไม่สำเร็จ"}{" "}
              <span
                className={`tabular font-bold ${
                  stealResult.correct ? "text-cyan-300" : "text-slate-400"
                }`}
              >
                +{stealResult.correct ? question.pointValue : 0}
              </span>
            </div>
          ) : null}

          {/* เฉลยกล่องทั้ง 4 */}
          {revealed ? (
            <div className="panel space-y-2 p-4">
              <h3 className="text-sm font-bold text-slate-200">
                เฉลยกล่องคำใบ้ทั้งหมด
              </h3>
              {revealed.map((b) => {
                const wasOpened = openedIds.includes(b.id);
                return (
                  <div
                    key={b.id}
                    className={`rounded-xl border p-3 ${
                      b.truth === "จริง"
                        ? "border-teal-300/45 bg-teal-400/[0.08]"
                        : "border-rose-400/40 bg-rose-500/[0.06]"
                    }`}
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <span className="chip bg-white/10 px-2 py-0.5 text-[10px] text-slate-200">
                        กล่อง {b.label}
                      </span>
                      <span
                        className={`chip px-2 py-0.5 text-[10px] ${
                          b.truth === "จริง"
                            ? "bg-teal-400/25 text-teal-100"
                            : "bg-rose-500/25 text-rose-100"
                        }`}
                      >
                        {b.truth === "จริง" ? "✅ ใบ้จริง" : "🎭 ใบ้หลอก"}
                      </span>
                      {wasOpened ? (
                        <span className="chip bg-sky-500/20 px-2 py-0.5 text-[10px] text-sky-100">
                          คุณเปิดกล่องนี้
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs leading-relaxed text-white">{b.text}</p>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                      <b className="text-slate-300">ทำไมถึงใบ้แบบนี้:</b> {b.rationale}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : null}

          <button
            ref={nextBtnRef}
            onClick={() => dispatch({ type: "NEXT_QUESTION" })}
            className="btn-primary w-full py-4 text-lg"
          >
            {isLast ? "ดูสรุปผล" : "ข้อถัดไป"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
