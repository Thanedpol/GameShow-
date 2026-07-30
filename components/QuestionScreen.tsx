"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ScoreBoard from "./ScoreBoard";
import TeammateNotes from "./TeammateNotes";
import {
  ActionBar,
  HintBoxBody,
  HintGrid,
  LiveDrafts,
  OpenedHints,
  QuestionMeta,
  QuestionPanel,
  RevealList,
  type StageBox,
} from "./StageView";
import { useGame } from "@/lib/gameStore";
import { useRoom } from "@/lib/roomClient";
import { BOT_LEVELS, botRemark, planBotTurn, type BotLevel } from "@/lib/bot";
import { activeParticipantIndex, hintMultiplier } from "@/lib/scoring";
import { useCountdown } from "@/lib/useCountdown";
import { takeHints, warmHints } from "@/lib/hintPrefetch";
import { shrinkImage } from "@/lib/shrinkImage";
import { llmRequestPayload } from "@/lib/settings";
import { useSpeechInput } from "@/lib/useSpeechInput";
import { useVoiceRecorder } from "@/lib/useVoiceRecorder";
import type { VoiceCritique } from "@/lib/voiceCoach";
import type { CritiqueApiResponse } from "@/app/api/critique/route";
import type { TranscribeApiResponse } from "@/app/api/transcribe/route";
import type {
  GradeApiResponse,
  HintApiResponse,
  HintBox,
  Participant,
  RevealApiResponse,
  RevealedHintBox,
} from "@/lib/types";

/**
 * ช่วงของหนึ่งข้อ — ขึ้นข้อมาก็ตอบได้เลย ไม่มีจอคั่นให้กดอะไรก่อน
 *
 * เคยมีช่วง `buzzing` ให้แข่งกันกดชิงสิทธิ์ตอบ ใส่ไว้เพื่อให้คนกับบอท
 * เจอโจทย์ข้อเดียวกัน (ของเดิมผลัดกันตอบคนละข้อ คะแนนเลยเทียบกันไม่ได้)
 * แต่พอเล่นจริงมันกลายเป็นจอขวางทุกข้อ — ต้องกดเลือกคนตอบก่อนถึงจะเห็นช่องตอบ
 * และในโหมดที่มีผู้เล่นคนเดียว ก็เหลือปุ่มให้กดใบเดียวซึ่งไม่ได้ตัดสินอะไรเลย
 *
 * ตอนนี้แก้ปัญหาเดิมด้วยวิธีที่ไม่ต้องมีจอคั่น: บอทตอบข้อเดียวกับคนเสมอ
 * โดยตอบตามหลังทันทีที่คนส่งคำตอบ (ดู commit) ส่วนโหมดหลายคนก็ผลัดกันตอบ
 * ตามลำดับข้อ ตรงกับที่เขียนไว้บนการ์ดเลือกโหมดว่า "2–4 คน ผลัดกันตอบ"
 *
 * ส่วนช่วง `steal` (แย่งตอบหลังคนแรกตอบผิด) ถูกตัดทิ้งไปก่อนหน้านี้แล้ว
 */
type Local =
  | "answering"
  | "performing"
  | "grading"
  | "result";

/**
 * ปุ่มไมค์ข้างช่องพิมพ์คำตอบ — พูดแทนพิมพ์ตอนเวลาไม่พอ
 *
 * ข้อความที่ได้จะ "ต่อท้าย" ของเดิม ไม่ทับ เพราะผู้เล่นมักพิมพ์ไปบ้างแล้ว
 * ค่อยนึกได้ว่าพูดเร็วกว่า ถ้าทับของเดิมจะเสียสิ่งที่พิมพ์ไปฟรี ๆ
 */
function MicButton({
  onAppend,
  onInterim,
  disabled,
}: {
  onAppend: (text: string) => void;
  onInterim: (text: string) => void;
  disabled?: boolean;
}) {
  const speech = useSpeechInput({
    onText: (text, final) => (final ? onAppend(text) : onInterim(text)),
  });

  if (speech.mode === "none") return null;
  const busy = speech.state === "listening";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void (busy ? speech.stop() : speech.start())}
        disabled={disabled || speech.state === "transcribing"}
        aria-label={busy ? "หยุดพูด" : "พูดแทนพิมพ์"}
        className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition disabled:opacity-50 ${
          busy
            ? "border-rose-400/70 bg-rose-500/20 text-rose-100"
            : "border-stage-edge bg-white/[0.04] text-slate-200 hover:bg-white/[0.09]"
        }`}
      >
        {busy ? (
          <>
            <span className="h-2 w-2 animate-pulse rounded-full bg-rose-400" />
            หยุดพูด
          </>
        ) : speech.state === "transcribing" ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-sky-300" />
            กำลังถอดเสียง...
          </>
        ) : (
          <>🎤 พูดแทนพิมพ์</>
        )}
      </button>
      {speech.error ? (
        <span className="text-xs text-amber-300">{speech.error}</span>
      ) : busy && speech.mode === "upload" ? (
        <span className="text-xs text-slate-500">พูดจบแล้วกดหยุด เดี๋ยวถอดให้</span>
      ) : null}
    </div>
  );
}

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
  const { isHost, syncLive, session, sendDraft } = useRoom();
  const question = state.questions[state.currentQuestionIndex];

  /**
   * ใครเป็นคนตอบข้อนี้
   *
   * โหมดดวลบอท — คนตอบทุกข้อ ส่วนบอทตอบข้อเดียวกันตามหลัง (ดู commit)
   * ถ้าให้บอทผลัดมาตอบเป็นบางข้อ คนจะได้เจอโจทย์คนละชุดกับบอท เทียบคะแนนไม่ได้
   * โหมดอื่น — ผลัดกันตอบตามลำดับข้อ ตรงกับที่เขียนบนการ์ดเลือกโหมด
   */
  const bot = state.participants.find((p) => p.kind === "bot") ?? null;
  const active: Participant | undefined = bot
    ? state.participants.find((p) => p.kind !== "bot")
    : state.participants[
        activeParticipantIndex(state.currentQuestionIndex, state.participants.length)
      ];

  const [phase, setPhase] = useState<Local>("answering");
  const [boxes, setBoxes] = useState<HintBox[] | null>(null);
  const [revealToken, setRevealToken] = useState<string | null>(null);
  const [hintSource, setHintSource] = useState<"llm" | "fallback">("llm");
  const [hintFailed, setHintFailed] = useState(false);
  const [openedIds, setOpenedIds] = useState<string[]>([]);
  const [useToken, setUseToken] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [text, setText] = useState("");
  /**
   * ข้อความชั่วคราวระหว่างพูด (โหมด live)
   *
   * แยกจาก `text` แทนที่จะเขียนลงช่องพิมพ์ตรง ๆ เพราะช่องพิมพ์เป็น controlled input
   * ที่ผู้เล่นแก้เองได้ตลอด ถ้าเอาผลระหว่างพูดไปทับจะแย่งเคอร์เซอร์กับที่พิมพ์ค้างไว้
   * ตรงนี้จึงโชว์เป็นตัวอย่างใต้ช่อง แล้วค่อยต่อท้ายจริงตอนประโยคนั้นนิ่งแล้ว
   */
  const [interim, setInterim] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [revealed, setRevealed] = useState<RevealedHintBox[] | null>(null);
  // ── โค้ชเสียง — ของแถมของข้อโชว์ความสามารถ พังได้โดยไม่กระทบเกม ──────────
  const recorder = useVoiceRecorder();
  const [critique, setCritique] = useState<VoiceCritique | null>(null);
  const [critiqueState, setCritiqueState] = useState<"off" | "listening" | "done" | "failed">(
    "off",
  );
  const [critiqueReason, setCritiqueReason] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  /** วินาทีที่ผ่านไประหว่างรอ AI ตรวจ — วัดจริงแล้วราว 6 วินาที ซึ่งนานพอที่จะ
   *  ทำให้คนคิดว่าจอค้างถ้าไม่มีอะไรขยับให้เห็น */
  const [gradeSecs, setGradeSecs] = useState(0);
  /** ผลของบอทในข้อเดียวกัน — โผล่ในหน้าเฉลยข้างผลของคน */
  const [botResult, setBotResult] = useState<{
    name: string;
    points: number;
    quality: number;
    boxesOpened: number;
    remark: string;
  } | null>(null);

  const phaseRef = useRef<Local>(phase);
  phaseRef.current = phase;
  const textRef = useRef(text);
  textRef.current = text;
  const resolvedRef = useRef(false);
  // นาฬิกาถูกสร้างก่อน loadReveal จึงอ่านโทเคนผ่าน ref แทนตัวแปรตรง ๆ
  const revealTokenRef = useRef<string | null>(null);
  const nextBtnRef = useRef<HTMLButtonElement | null>(null);

  /**
   * กระจายข้อความที่เจ้าภาพกำลังพิมพ์ให้เพื่อนร่วมทีมเห็น และขอของเขามาด้วย
   *
   * เปิดเฉพาะช่วงที่กำลังตอบจริง ๆ — ช่วงเฉลย/ตรวจ/ชิงกดตอบไม่ต้องดึง
   * เพราะการดึง draft เพิ่มคำสั่ง Redis อีกหนึ่งครั้งต่อการ poll หนึ่งรอบ
   * ถ้าเปิดทิ้งไว้ทั้งเกมจะกินโควตาเพิ่มราวครึ่งหนึ่งโดยไม่ได้ใช้
   */
  const answering = phase === "answering" || phase === "performing";
  useEffect(() => {
    if (!session || !question) return;
    sendDraft(answering ? text : "", question.id);
  }, [session, question, answering, text, sendDraft]);

  // เดินตัวนับเฉพาะตอนกำลังตรวจ แล้วรีเซ็ตเมื่อออกจากช่วงนั้น
  useEffect(() => {
    if (phase !== "grading") {
      setGradeSecs(0);
      return;
    }
    const t = window.setInterval(() => setGradeSecs((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [phase]);

  const timer = useCountdown(() => {
    const p = phaseRef.current;
    if (p === "answering" || p === "performing") void finish(true);
  });
  const { start: startTimer, stop: stopTimer } = timer;

  /** ไมค์ใช้งานได้จริงไหม — ตัวตัดสินว่าข้อโชว์ต้องมีช่องพิมพ์สำรองหรือไม่ */
  const micWorks = recorder.state === "recording" || recorder.state === "requesting";

  const openedBoxes = (boxes ?? []).filter((b) => openedIds.includes(b.id));
  const tokenSpent = useToken && openedIds.length > 0;
  const paidBoxes = Math.max(0, openedIds.length - (tokenSpent ? 1 : 0));
  const cfg = state.settings;
  // เวลาและจำนวนกล่องที่เปิดได้ ต่างกันในแต่ละช่วง
  const stageSeconds = question ? cfg.seconds[question.stage] : 60;
  const maxOpen = question ? cfg.maxOpenBoxes[question.stage] : 1;
  const openLimitReached = openedIds.length >= maxOpen;
  const remainingPct = Math.round(hintMultiplier(paidBoxes, cfg.boxCostRatio) * 100);

  /**
   * กล่องคำใบ้ในรูปแบบที่ใช้วาดจอได้ — เนื้อในจะโผล่เฉพาะกล่องที่เปิดแล้ว
   * ก้อนเดียวกันนี้ส่งข้ามเครื่องไปให้จอเพื่อนด้วย สองจอจึงเห็นตรงกันเสมอ
   */
  const stageBoxes: StageBox[] | null = useMemo(
    () =>
      boxes
        ? boxes.map((b) => ({
            id: b.id,
            label: b.label,
            // ส่งโซนไปด้วยเสมอ ผู้ติดตามจะได้เห็นว่ากล่องไหนเป็นกล่องภาพ
            // ส่วนเนื้อในยังปิดอยู่จนกว่าเจ้าภาพจะเปิด
            zone: b.zone ?? null,
            text: openedIds.includes(b.id) ? b.text : null,
          }))
        : null,
    [boxes, openedIds],
  );

  // ── รีเซ็ตต่อข้อ + เริ่มนาฬิกา 60 วิ (ไม่มีการหยุดพักระหว่างข้อ) ──────────
  useEffect(() => {
    resolvedRef.current = false;
    // ขึ้นข้อมาก็เข้าช่วงตอบทันที ไม่มีจอคั่นให้กดเลือกคนตอบก่อน
    setPhase(question?.format === "performance" ? "performing" : "answering");
    setBotResult(null);
    setOpenedIds([]);
    setUseToken(false);
    setChoice(null);
    setText("");
    setInterim("");
    setOutcome(null);
    setRevealed(null);
    setBoxes(null);
    setRevealToken(null);
    revealTokenRef.current = null;
    setHintFailed(false);
    setCritique(null);
    setCritiqueState("off");
    setCritiqueReason(null);
    setTranscribing(false);
    // ปล่อยไมค์ที่อาจค้างจากข้อก่อน (เช่นหมดเวลากลางการแสดงแล้วข้ามมา)
    recorder.reset();
    startTimer(stageSeconds * 1000);
    return () => stopTimer();
    // recorder.reset เป็น callback ที่นิ่ง ไม่ต้องใส่ใน deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentQuestionIndex, question?.format, stageSeconds, startTimer, stopTimer]);

  // ── ส่งสถานะสดให้เพื่อนร่วมทีมที่ใช้เครื่องอื่น ──────────────────────────
  // นาฬิกากับกล่องคำใบ้เป็น state ในหน้านี้ ไม่ได้อยู่ใน reducer จึงต้องส่งแยก
  // ใช้ timer.deadlineAt ตรง ๆ เพราะเป็นเวลาปลายทางจริง ไม่เพี้ยนตามการหน่วง
  // ของแท็บ และเปลี่ยนแค่ตอนขึ้นข้อใหม่ จึงไม่ยิงเครือข่ายทุก tick
  /**
   * ภาพประกอบของข้อนี้ ย่อแล้ว เตรียมไว้ส่งข้ามเครื่อง
   *
   * ผู้ใช้รายงานว่าจอมือถือของเพื่อนไม่มีภาพโจทย์เลย ทั้งที่จอเจ้าภาพมี
   * เพราะ stripHeavyFields ตัด imageUrl ออกจากสแนปช็อตเพื่อไม่ให้ก้อนใหญ่เกิน
   * (คำถาม 20 ข้อ × ภาพละ ~800KB = 3-5MB ซึ่งส่งไม่ได้)
   * ย่อเหลือราว 1 ใน 10 แล้วส่งทางสถานะสดแทน ซึ่งมีทีละข้อจึงมีภาพเดียวเสมอ
   */
  const [liveImage, setLiveImage] = useState<string | null>(null);
  useEffect(() => {
    if (!isHost || !question?.imageUrl) {
      setLiveImage(null);
      return;
    }
    let cancelled = false;
    void shrinkImage(question.imageUrl).then((small) => {
      if (!cancelled) setLiveImage(small);
    });
    return () => {
      cancelled = true;
    };
  }, [isHost, question?.imageUrl]);

  useEffect(() => {
    if (!isHost) return;
    syncLive({
      questionId: question?.id ?? null,
      imageUrl: liveImage,
      deadlineAt: timer.deadlineAt,
      // เวลาเต็มของช่วงนี้ — วงแหวนนับถอยหลังต้องรู้ ไม่งั้นวาดสัดส่วนไม่ได้
      durationMs: stageSeconds * 1000,
      boxes: stageBoxes ?? [],
      openedCount: openedIds.length,
      openedIds,
      // เฉลยส่งไปด้วยเมื่อมีแล้ว — จอเพื่อนจะได้เห็นว่ากล่องไหนหลอก
      reveal:
        revealed?.map((b) => ({
          id: b.id,
          label: b.label,
          text: b.text,
          truth: b.truth,
          rationale: b.rationale,
        })) ?? null,
      strengths: outcome?.strengths,
      improvements: outcome?.improvements,
      // คิดจากฝั่งเจ้าภาพแล้วส่งไป เพราะการใช้โทเคนเป็น state ในจอนี้เท่านั้น
      // ถ้าให้จอเพื่อนคำนวณเองจะได้ตัวเลขไม่ตรงกันตอนมีคนกาช่องใช้โทเคน
      remainingPct,
      activeParticipantId: active?.id ?? null,
      step: phase,
    });
  }, [
    isHost,
    syncLive,
    question?.id,
    liveImage,
    timer.deadlineAt,
    stageSeconds,
    stageBoxes,
    openedIds,
    remainingPct,
    revealed,
    outcome,
    active?.id,
    phase,
  ]);

  /**
   * รับกล่องคำใบ้ที่เตรียมไว้ แล้วสั่งเตรียมของข้อถัดไปต่อทันที
   *
   * เดิมมี ref กันไม่ให้ยิงซ้ำต่อข้อ แต่พอย้ายมาใช้แคชแล้วมันกลายเป็นบั๊ก:
   * React ใน dev รัน effect สองรอบต่อการ mount หนึ่งครั้ง รอบสองติด guard
   * เลย early-return ทั้งที่ effect รีเซ็ตต่อข้อ (ที่ประกาศไว้ก่อนหน้า)
   * ล้าง boxes เป็น null ไปแล้ว — ผลคือกล่องค้างที่ "กำลังเตรียม" ตลอดกาล
   *
   * เดิมไม่เจอเพราะการยิงจริงใช้เวลา ~8 วินาที กว่าผลจะกลับมาก็พ้นจังหวะนั้นไปแล้ว
   * พอแคชตอบกลับทันทีปัญหาถึงโผล่ · ตอนนี้ตัด guard ทิ้งแล้วให้แคชกันการยิงซ้ำแทน
   * ซึ่งเป็นหน้าที่ของมันอยู่แล้ว
   */
  useEffect(() => {
    if (!question) return;
    let cancelled = false;
    void takeHints(question).then((data) => {
      if (cancelled) return;
      if (!data) {
        setHintFailed(true);
        return;
      }
      setBoxes(data.boxes);
      setRevealToken(data.revealToken);
      revealTokenRef.current = data.revealToken;
      setHintSource(data.source);
    });

    // เตรียมของข้อถัดไปตั้งแต่ตอนนี้ ระหว่างที่ผู้เล่นกำลังคิดข้อนี้อยู่
    // พอกดข้อถัดไป กล่องจะขึ้นทันทีแทนที่จะขึ้นว่า "กำลังเตรียม" อีก ~8 วินาที
    warmHints(state.questions[state.currentQuestionIndex + 1]);

    return () => {
      cancelled = true;
    };
  }, [question, state.currentQuestionIndex, state.questions]);

  // ── โฟกัสปุ่มถัดไป ───────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === "result") nextBtnRef.current?.focus();
  }, [phase]);

  /**
   * เริ่มอัดเสียงตอนเข้าเฟสแสดงสด
   *
   * ขอสิทธิ์ไมค์ตรงนี้แทนที่จะขอตอนเปิดเกม เพราะผู้เล่นจะเห็นบริบทชัดกว่า
   * ว่าขอไปทำอะไร — และเกมส่วนใหญ่ไม่มีข้อโชว์เลยก็ไม่ต้องขอ
   * ไม่ได้สิทธิ์ก็ไม่เป็นไร ตัวฮุกจัดการสถานะเองแล้ว เกมเดินต่อได้
   */
  useEffect(() => {
    if (phase !== "performing") return;
    void recorder.start();
    // ตั้งใจ "ไม่" คืนฟังก์ชันเคลียร์ตรงนี้
    // เพราะพอกด "จบการแสดง" เฟสจะเปลี่ยนเป็น rating ทันที ถ้าเคลียร์ตอนนั้น
    // ไมค์จะถูกปิดแข่งกับ recorder.stop() ที่กำลังเก็บคลิปอยู่ แล้วคลิปจะขาด
    // การปล่อยไมค์ทำที่ stop() อยู่แล้ว ส่วนกรณีออกกลางคันมี reset ตอนขึ้นข้อใหม่
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, state.currentQuestionIndex]);

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
    }) => {
      if (!question || !active) return;
      stopTimer();

      const usedBoxes = openedBoxes;
      const usedCount = usedBoxes.length;
      const usedPaid = paidBoxes;

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
          tokenSpent,
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

      /**
       * บอทตอบข้อเดียวกันทันทีที่คนส่งคำตอบ
       *
       * นี่คือเหตุผลที่ตัดช่วงชิงกดตอบออกได้ — ปัญหาเดิมคือบอทกับคนเจอโจทย์
       * คนละชุดจนเทียบคะแนนกันไม่ได้ พอให้บอทตอบทุกข้อตามหลัง ทั้งคู่ก็เจอ
       * โจทย์ชุดเดียวกันครบ 20 ข้อ โดยไม่ต้องมีจอให้กดเลือกคนตอบมาคั่น
       *
       * บอทเปิดกล่องเองได้และโดนหักคะแนนเหมือนกัน แต่ไม่ใช้โทเคน
       * (โทเคนเป็นรางวัลของคนที่ตอบถูกโดยไม่เปิดกล่อง ให้บอทใช้ด้วยจะงงเปล่า ๆ)
       */
      if (bot) {
        const level = BOT_LEVELS.find((l) => bot.name.includes(l)) ?? ("ปกติ" as BotLevel);
        const plan = planBotTurn(question, level);
        const botBoxes = boxes ? boxes.slice(0, Math.min(plan.boxesOpened, maxOpen)) : [];
        const botPoints =
          plan.quality <= 0
            ? 0
            : Math.max(
                0,
                Math.round(
                  question.pointValue *
                    hintMultiplier(botBoxes.length, cfg.boxCostRatio) *
                    (plan.quality / 100),
                ),
              );
        dispatch({
          type: "RESOLVE_ROUND",
          payload: {
            participantId: bot.id,
            answer: plan.choice ?? "(บอทตอบ)",
            quality: plan.quality,
            boxesOpened: botBoxes.length,
            tokenSpent: false,
            timedOut: false,
            openedBoxes:
              revealToken && botBoxes.length > 0
                ? botBoxes.map((b) => ({
                    boxId: b.id,
                    boxLabel: b.label,
                    text: b.text,
                    revealToken,
                  }))
                : undefined,
          },
        });
        setBotResult({
          name: bot.name,
          points: botPoints,
          quality: plan.quality,
          boxesOpened: botBoxes.length,
          remark: botRemark({ ...plan, boxesOpened: botBoxes.length }, level),
        });
      }

      // ตอบผิดก็จบข้อนั้นเลย ไม่เปิดให้คนอื่นแย่งต่อ — กติกาแย่งตอบถูกตัดไปแล้ว
      setPhase("result");
    },
    [
      question,
      active,
      bot,
      boxes,
      maxOpen,
      openedBoxes,
      paidBoxes,
      tokenSpent,
      revealToken,
      cfg.boxCostRatio,
      dispatch,
      loadReveal,
      stopTimer,
    ],
  );

  /**
   * ปิดไมค์แล้วใช้คลิปเดียวทำสองงานพร้อมกัน
   *   1. ถอดเป็นข้อความ → กลายเป็น "คำตอบ" ของข้อนี้ (ต้องรอ)
   *   2. ส่งให้โค้ชฟังแล้วให้ฟีดแบ็ก (ไม่ต้องรอ ค่อยโผล่ตอนสรุปผล)
   *
   * ใช้คลิปเดียวเพราะอัดซ้ำสองรอบไม่ได้ — ผู้เล่นแสดงไปแล้วรอบเดียว
   */
  const useClipAsAnswer = useCallback(
    async (q: NonNullable<typeof question>): Promise<string> => {
      const clip = await recorder.stop();
      if (!clip) return "";

      // โค้ชทำงานเบื้องหลัง ไม่ให้ไปหน่วงการตรวจคำตอบ
      setCritiqueState("listening");
      void (async () => {
        try {
          const res = await fetch("/api/critique", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              audio: clip.base64,
              mimeType: clip.mimeType,
              task: q.task ?? q.prompt,
              rubric: q.rubric,
              llm: llmRequestPayload("voice"),
            }),
          });
          const data = (await res.json()) as CritiqueApiResponse;
          if (data.ok && data.critique) {
            setCritique(data.critique);
            setCritiqueState("done");
          } else {
            setCritiqueReason(data.reason ?? "ไม่ทราบสาเหตุ");
            setCritiqueState("failed");
          }
        } catch (e) {
          setCritiqueReason(String(e));
          setCritiqueState("failed");
        }
      })();

      try {
        const res = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audio: clip.base64,
            mimeType: clip.mimeType,
            llm: llmRequestPayload("voice"),
          }),
        });
        const data = (await res.json()) as TranscribeApiResponse;
        return data.ok ? (data.text ?? "").trim() : "";
      } catch {
        return "";
      }
    },
    // recorder.stop เป็น callback ที่นิ่ง
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
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

      // อัตนัยกับโชว์ความสามารถเดินทางเดียวกันแล้ว — พิมพ์คำตอบ แล้ว AI ตรวจตามเกณฑ์
      // ต่างกันแค่ข้อโชว์มีเสียงที่อัดไว้ให้โค้ชฟังเพิ่ม
      if (question.format === "open" || question.format === "performance") {
        stopTimer();

        let answer = textRef.current.trim();
        if (question.format === "performance") {
          // ข้อโชว์ = เล่า/ร้อง/พูด สิ่งที่พูดคือคำตอบ ไม่ต้องให้พิมพ์ซ้ำ
          setPhase("grading");
          setTranscribing(true);
          const spoken = await useClipAsAnswer(question);
          setTranscribing(false);
          if (spoken) answer = spoken;
          // ถอดเสียงไม่ได้และไม่ได้พิมพ์อะไรไว้ → ถือว่าไม่ได้ตอบ
          setText(answer);
        }

        if (!answer) {
          commit({ answer: null, quality: 0, timedOut: true });
          return;
        }
        setPhase("grading");
        try {
          const res = await fetch("/api/grade", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              questionId: question.id,
              question,
              answer,
              llm: llmRequestPayload("grade"),
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

    },
    // useClipAsAnswer กับ recorder เป็น callback ที่นิ่ง ไม่ต้องใส่ใน deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [question, choice, commit, stopTimer],
  );

  /** ต่อข้อความที่พูดท้ายของเดิม ไม่ทับ — ผู้เล่นอาจพิมพ์ค้างไว้แล้ว */
  const appendSpoken = useCallback((spoken: string) => {
    setInterim("");
    setText((prev) => {
      const joined = prev.trim() ? `${prev.trim()} ${spoken.trim()}` : spoken.trim();
      return joined.slice(0, 1200);
    });
  }, []);

  function openBox(id: string) {
    if (openedIds.includes(id)) return;
    setOpenedIds((prev) => [...prev, id]);
  }

  if (!question) return null;

  const totalQuestions = state.questions.length;
  const isLast = state.currentQuestionIndex + 1 >= totalQuestions;

  return (
    <div className="space-y-4">
      <ScoreBoard activeId={active?.id ?? null} />

      <QuestionMeta
        question={question}
        index={state.currentQuestionIndex}
        total={totalQuestions}
        activeLine={active ? `${active.name} ตอบข้อนี้` : "—"}
        remaining={timer.remaining}
        totalMs={stageSeconds * 1000}
        timerLabel="เวลาที่เหลือ"
        paused={phase === "grading" || phase === "result"}
      />

      <QuestionPanel question={question} imageUrl={question.imageUrl} />

      {/* ── กล่องคำใบ้ 4 กล่อง ─────────────────────────────────────────── */}
      {phase === "answering" || phase === "performing" ? (
        <div className="space-y-2">
          {active && active.tokens > 0 ? (
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-cyan-300/40 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100">
              <input
                type="checkbox"
                checked={useToken}
                onChange={(e) => setUseToken(e.target.checked)}
                className="h-4 w-4 accent-cyan-400"
              />
              ใช้โทเคน 1 ชิ้น — กล่องแรกที่เปิดไม่หักคะแนน (มี {active?.tokens ?? 0} ชิ้น)
            </label>
          ) : null}

          <HintGrid
            boxes={stageBoxes}
            boxCount={cfg.boxCount}
            maxOpen={maxOpen}
            openedCount={openedIds.length}
            costPct={Math.round(cfg.boxCostRatio * 100)}
            remainingPct={remainingPct}
            imageUrl={question.imageUrl}
            onOpen={openBox}
            footer={
              hintFailed ? (
                <p className="text-xs text-rose-300">
                  เตรียมกล่องคำใบ้ไม่สำเร็จ — ข้อนี้เล่นต่อได้โดยไม่มีคำใบ้
                </p>
              ) : hintSource === "fallback" && boxes ? (
                <p className="text-xs text-cyan-200/70">
                  โหมดสำรอง — ยังต่อโมเดลไม่ได้ (เช็กที่หลังบ้าน → แท็บ API)
                </p>
              ) : null
            }
          />
        </div>
      ) : null}

      {/* คำใบ้ที่เปิดไว้ — ค้างบนจอจนขึ้นเฉลย ดูเหตุผลที่ OpenedHints */}
      {phase !== "answering" && phase !== "performing" && !(phase === "result" && revealed) ? (
        <OpenedHints
          boxes={(stageBoxes ?? []).filter((b) => b.text !== null)}
          imageUrl={question.imageUrl}
        />
      ) : null}

      {/* ── ข้อเสนอจากเพื่อนร่วมทีมที่ใช้อีกเครื่อง ─────────────────────── */}
      {phase === "answering" || phase === "performing" ? (
        <div className="space-y-2">
          <LiveDrafts questionId={question.id} onUse={appendSpoken} />
          <TeammateNotes questionId={question.id} />
        </div>
      ) : null}

      {/* ── ปรนัย ───────────────────────────────────────────────────────── */}
      {phase === "answering" && question.format === "choice" ? (
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
      {phase === "answering" && question.format === "open" ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            maxLength={1200}
            placeholder="พิมพ์คำตอบของคุณ... (หรือกดปุ่มไมค์แล้วพูด)"
            className="field min-h-[130px] resize-y leading-relaxed"
          />
          {interim ? (
            <p className="rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-xs italic leading-relaxed text-sky-100">
              🎤 {interim}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ── โชว์ความสามารถ — แสดงสดแล้วพิมพ์สรุปสิ่งที่พูด ─────────────────
          เดิมกดจบแล้วเด้งไปให้คนกดดาว ซึ่งใช้ไม่ได้เวลาเล่นคนเดียว
          ตอนนี้ให้พิมพ์คำตอบแล้ว AI ตรวจตามเกณฑ์เหมือนข้ออัตนัย
          ส่วนเสียงที่อัดไว้เอาไปให้โค้ชฟังเป็นฟีดแบ็กเพิ่ม ไม่ใช่ตัวให้คะแนน */}
      {phase === "performing" ? (
        <div className="space-y-2">
          <div className="panel space-y-2 p-4 text-center">
            {micWorks ? (
              <>
                <p className="text-sm text-slate-300">
                  เล่า/ร้อง/พูดได้เลย — ไมค์เปิดอยู่ ระบบจะถอดสิ่งที่คุณพูดเป็นคำตอบให้เอง
                  ไม่ต้องพิมพ์
                </p>
                <p className="flex items-center justify-center gap-2 text-xs text-rose-200">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-rose-400" />
                  กำลังฟังอยู่ · จับเวลาอยู่
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-300">
                แสดงสดได้เลย — จับเวลาอยู่ ·{" "}
                {recorder.state === "denied"
                  ? "ไม่ได้สิทธิ์ใช้ไมค์"
                  : "เบราว์เซอร์นี้ใช้ไมค์ไม่ได้"}{" "}
                จึงต้องพิมพ์สรุปสิ่งที่พูดลงช่องด้านล่างแทน
              </p>
            )}
          </div>

          {/* ไมค์ใช้ได้ = ไม่ต้องมีช่องพิมพ์ให้เกะกะ ผู้เล่นแค่เล่าแล้วกดจบ
              ช่องพิมพ์โผล่เฉพาะตอนไมค์ใช้ไม่ได้ ซึ่งเป็นทางสำรองล้วน ๆ */}
          {!micWorks ? (
            <>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                maxLength={1200}
                placeholder="พิมพ์สิ่งที่คุณพูดหรือแสดงไป..."
                className="field min-h-[130px] resize-y leading-relaxed"
              />
              <span className="text-xs text-slate-500">{text.length}/1200</span>
            </>
          ) : null}

        </div>
      ) : null}


      {/* ── กำลังตรวจ ───────────────────────────────────────────────────── */}
      {phase === "grading" ? (
        <div className="panel flex flex-col items-center gap-3 p-8 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/15 border-t-sky-300" />
          <p className="text-sm text-slate-300">
            {transcribing
              ? "กำลังถอดสิ่งที่คุณพูดเป็นข้อความ..."
              : "AI กำลังตรวจคำตอบตามเกณฑ์ของข้อนี้..."}
          </p>
          {!transcribing ? (
            <p className="text-xs text-slate-500" aria-live="polite">
              {gradeSecs} วินาที{gradeSecs >= 12 ? " · ช้ากว่าปกติ กำลังลองใหม่ให้" : ""}
            </p>
          ) : null}
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
                ? `⏱️ ${active?.name ?? ""} หมดเวลา`
                : outcome.points > 0
                  ? `✅ ${active?.name ?? ""} ได้คะแนน`
                  : `❌ ${active?.name ?? ""} ไม่ได้คะแนนข้อนี้`}
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

            {/* ── ที่มาของประเด็น ─────────────────────────────────────────────
                คำถามกับเฉลยเขียนโดย AI ซึ่งพลาดได้ ถ้าไม่มีทางตรวจ ผู้เล่นก็ได้แต่
                เชื่อไปเรื่อย ๆ ซึ่งขัดกับแก่นของเกมที่สอนให้ตรวจสอบก่อนเชื่อ
                ลิงก์ตรงนี้ผ่านการเทียบกับชุดข่าวที่ระบบดึงมาจริงแล้ว ไม่ใช่ที่ AI พิมพ์เอง */}
            {question.sourceUrl ? (
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                ที่มาของประเด็น:{" "}
                <a
                  href={question.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sky-300 underline hover:text-sky-200"
                >
                  {question.sourceName ?? "อ่านต้นทาง"} ↗
                </a>{" "}
                — เฉลยเขียนโดย AI ถ้าเห็นว่าไม่ตรง ให้ยึดต้นทางเป็นหลัก
              </p>
            ) : null}

            {/* ── ฟีดแบ็กจากโค้ชเสียง — เฉพาะข้อโชว์ความสามารถที่อัดเสียงไว้ ──
                ไม่มีผลต่อคะแนน เป็นคำแนะนำให้เอาไปฝึกต่ออย่างเดียว */}
            {critiqueState === "listening" ? (
              <p className="mt-3 flex items-center gap-2 rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-sky-300" />
                โค้ชเสียงกำลังฟังคลิปที่คุณเพิ่งแสดง...
              </p>
            ) : critiqueState === "done" && critique ? (
              <div className="mt-3 space-y-2 rounded-xl border border-teal-300/40 bg-teal-400/10 p-3">
                <p className="text-xs font-bold text-teal-100">
                  🎤 โค้ชเสียงฟังแล้วว่า
                  <span className="ml-1 font-normal text-teal-200/70">
                    (คำแนะนำอย่างเดียว ไม่มีผลต่อคะแนน)
                  </span>
                </p>
                {critique.audible ? (
                  <>
                    <p className="text-xs leading-relaxed text-teal-50">{critique.summary}</p>
                    {critique.strengths.map((s, i) => (
                      <p key={`s${i}`} className="text-xs leading-relaxed text-teal-100">
                        ✓ {s}
                      </p>
                    ))}
                    {critique.improvements.map((s, i) => (
                      <p key={`i${i}`} className="text-xs leading-relaxed text-amber-100">
                        → {s}
                      </p>
                    ))}
                    {critique.technique ? (
                      <p className="border-t border-white/10 pt-1.5 text-xs leading-relaxed text-slate-300">
                        <b className="text-slate-200">จุดที่หูคนทั่วไปมักไม่ทัน:</b>{" "}
                        {critique.technique}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-xs leading-relaxed text-amber-100">
                    {critique.summary || "เสียงเบาเกินไปจนประเมินไม่ได้"}
                  </p>
                )}
              </div>
            ) : critiqueState === "failed" ? (
              <p className="mt-3 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-500">
                ไม่ได้ฟีดแบ็กจากโค้ชรอบนี้ — {critiqueReason}
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

          {/* ── บอทเจอโจทย์ข้อเดียวกันและตอบไปแล้ว ──────────────────────────
              ต้องโชว์ทุกข้อ ไม่ใช่โชว์เฉพาะข้อที่บอทผลัดมาตอบ ไม่งั้นคนจะไม่รู้ว่า
              คะแนนบอทที่ขึ้นบนแถบด้านบนโตขึ้นมาจากไหน */}
          {botResult ? (
            <div className="rounded-2xl border border-stage-edge bg-white/[0.03] p-4">
              <p className="text-sm font-bold text-slate-200">
                🤖 {botResult.name} เจอโจทย์ข้อเดียวกัน
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                {botResult.remark}
              </p>
              <div className="mt-2 flex items-baseline gap-3">
                <span
                  className={`tabular text-xl font-extrabold ${
                    botResult.points > 0 ? "text-teal-300" : "text-slate-400"
                  }`}
                >
                  +{botResult.points}
                </span>
                <span className="text-xs text-slate-500">
                  (คุณภาพคำตอบ {botResult.quality}%
                  {botResult.boxesOpened > 0
                    ? ` · เปิด ${botResult.boxesOpened} กล่อง`
                    : " · ไม่เปิดกล่อง"}
                  )
                </span>
              </div>
            </div>
          ) : null}

          {/* เฉลยกล่องทั้ง 4 */}
          {revealed ? <RevealList items={revealed} openedIds={openedIds} /> : null}

        </div>
      ) : null}

      {/* ── แถบปุ่มลงมือ ────────────────────────────────────────────────────
          ต้องเป็นลูกคนสุดท้ายของกล่องนอกสุด ไม่ใช่ซ่อนอยู่ในบล็อกย่อย
          เพราะ sticky ยึดกับ "กล่องแม่" ถ้าแม่เตี้ยกว่าจอ มันก็ไม่มีที่ให้ติด
          (ลองวางไว้ในบล็อกอัตนัยก่อนแล้ววัดได้ y=607 บนจอสูง 375 คือไม่ติดเลย) */}
      <ActionBar
        counter={
          (phase === "answering" && question.format === "open") ||
          (phase === "performing" && !micWorks)
            ? `${text.length}/1200`
            : ""
        }
      >
          {phase === "answering" && question.format === "open" ? (
            <>
              <MicButton onAppend={appendSpoken} onInterim={setInterim} />
              <button
                onClick={() => void finish(false)}
                disabled={!text.trim()}
                className="btn-primary flex-1 text-base sm:flex-none sm:px-8"
              >
                ส่งคำตอบ
              </button>
            </>
          ) : phase === "performing" ? (
            <>
              {micWorks ? null : (
                <MicButton onAppend={appendSpoken} onInterim={setInterim} />
              )}
              <button
                onClick={() => void finish(false)}
                disabled={!micWorks && !text.trim()}
                className="btn-teal flex-1 text-base disabled:opacity-50"
              >
                จบการแสดง → ส่งให้ตรวจ
              </button>
            </>
          ) : phase === "result" ? (
            <button
              ref={nextBtnRef}
              onClick={() => dispatch({ type: "NEXT_QUESTION" })}
              className="btn-primary flex-1 text-base"
            >
              {isLast ? "ดูสรุปผล" : "ข้อถัดไป"}
            </button>
          ) : null}
      </ActionBar>
    </div>
  );
}
