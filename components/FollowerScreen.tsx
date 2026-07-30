"use client";

import { useEffect, useState } from "react";
import RoomPanel from "./RoomPanel";
import ScoreBoard from "./ScoreBoard";
import TeammateNotes from "./TeammateNotes";
import {
  ActionBar,
  HintGrid,
  LiveDrafts,
  OpenedHints,
  QuestionMeta,
  QuestionPanel,
  RevealList,
  type StageBox,
} from "./StageView";
import { useRoom } from "@/lib/roomClient";
import { MAX_INTENT_LENGTH } from "@/lib/room";
import { rankParticipants } from "@/lib/scoring";

/**
 * จอของเพื่อนร่วมทีมที่ใช้อีกเครื่อง
 *
 * วาดจากสแนปช็อตที่เจ้าภาพส่งขึ้นห้อง ไม่มี state เกมของตัวเอง
 * ตั้งใจให้ "ดูได้ทุกอย่าง แต่กดตอบไม่ได้" — คนกดตอบมีคนเดียวคือเจ้าภาพ
 * จะได้ไม่เกิดกรณีสองคนกดพร้อมกันแล้วคะแนนเพี้ยน
 *
 * หน้าตาระหว่างเล่นใช้ชิ้นส่วนชุดเดียวกับจอเจ้าภาพทั้งหมด (ดู StageView)
 * ผู้ใช้รายงานว่า "หน้าไม่เหมือนกันเลย" เพราะเดิมจอนี้วาดเองคนละแบบ —
 * ได้หัวข้อเล็ก ๆ กับกล่องบอกวินาที ส่วนอีกจอได้แถบคะแนน ชิป และวงแหวน
 * ตอนนี้ต่างกันแค่ "กดได้ไหม" ซึ่งเป็น prop ไม่ใช่หน้าจอคนละอัน
 */
export default function FollowerScreen() {
  const { snapshot, live, sendIntent, session, drafts, sendDraft } = useRoom();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // นาฬิกาเดินเองจาก deadline ที่เจ้าภาพส่งมา จึงตรงกันโดยไม่ต้องซิงก์ทุกวินาที
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const question =
    snapshot && snapshot.questions.length > 0
      ? snapshot.questions[snapshot.currentQuestionIndex]
      : null;

  /**
   * เปิดรับ draft ของคนอื่นเฉพาะตอนที่กำลังเล่นข้ออยู่ และกระจายของตัวเองออกไป
   * ช่วงเฉลย/รอเริ่มเกมไม่ต้องดึง เพราะกินคำสั่ง Redis เพิ่มโดยไม่ได้ใช้
   */
  const answering = live?.step === "answering" || live?.step === "performing";
  useEffect(() => {
    sendDraft(answering ? draft : "", question?.id ?? null);
  }, [answering, draft, question?.id, sendDraft]);

  /** ต่อท้ายของเดิม ไม่ทับ — ผู้เล่นอาจพิมพ์ค้างไว้แล้ว (ตรรกะเดียวกับ appendSpoken) */
  function useDraftText(text: string) {
    setDraft((prev) => {
      const joined = prev.trim() ? `${prev.trim()} ${text.trim()}` : text.trim();
      return joined.slice(0, MAX_INTENT_LENGTH);
    });
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    const ok = await sendIntent(text, question?.id ?? null);
    setSending(false);
    if (ok) {
      setDraft("");
      setSent(true);
      window.setTimeout(() => setSent(false), 2000);
    }
  }

  // ── ยังไม่เริ่มเกม ────────────────────────────────────────────────────────
  if (!snapshot || snapshot.phase === "setup") {
    return (
      <div className="animate-popIn space-y-5">
        <header className="pt-4 text-center">
          <h1 className="text-2xl font-extrabold text-white">รอเจ้าภาพเริ่มเกม</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-400">
            พอเจ้าภาพกด "เริ่มเกม" จอนี้จะตามให้อัตโนมัติ
            เห็นคำถาม นาฬิกา และกล่องคำใบ้ชุดเดียวกัน
          </p>
          {/*
            ผู้ใช้รายงานว่า "เชิญเพื่อนได้ แต่ไม่มีปุ่มกดเริ่มเกม"
            สาเหตุคือจอนี้ตั้งใจไม่มีปุ่มอยู่แล้ว — เกมคุมจากเครื่องเจ้าภาพเครื่องเดียว
            แต่ของเดิมไม่ได้บอกตรง ๆ ว่า "ปุ่มอยู่ที่อีกเครื่อง" คนจึงนั่งหาปุ่มบนจอนี้
            และไม่มีทางรู้ว่าถ้าตัวเองต้องเป็นคนคุมเกม ต้องทำยังไงต่อ
          */}
          <div className="mx-auto mt-4 max-w-sm rounded-xl border border-sky-400/40 bg-sky-500/10 px-4 py-3 text-left text-xs leading-relaxed text-sky-100">
            <p className="font-semibold">ทำไมจอนี้ไม่มีปุ่ม "เริ่มเกม"</p>
            <p className="mt-1">
              เครื่องนี้เป็น <b>ผู้ติดตาม</b> — ปุ่มเริ่มเกมอยู่บนเครื่องของเจ้าภาพ
              ที่เป็นคนเปิดห้องเท่านั้น เพื่อไม่ให้สองเครื่องกดเริ่มพร้อมกันแล้วเกมชนกันเอง
            </p>
            <p className="mt-1.5 text-sky-200/90">
              ถ้าเครื่องนี้ต่างหากที่ต้องเป็นคนคุมเกม ให้กด <b>ออกจากห้อง</b> ด้านล่าง
              แล้วกด <b>เปิดห้องใหม่</b> จากนั้นส่งลิงก์เชิญให้อีกฝ่ายแทน
            </p>
          </div>
        </header>
        <RoomPanel defaultName={session?.name ?? ""} />
      </div>
    );
  }

  // ── จบเกมแล้ว ────────────────────────────────────────────────────────────
  if (snapshot.phase === "debrief") {
    const ranked = rankParticipants(snapshot.participants);
    return (
      <div className="animate-popIn space-y-5">
        <header className="pt-4 text-center">
          <h1 className="text-3xl font-extrabold text-white">จบเกมแล้ว</h1>
          <p className="mt-2 text-sm text-slate-400">
            ดูสรุปคำใบ้แบบเต็มได้ที่จอเจ้าภาพ
          </p>
        </header>
        <section className="panel space-y-2 p-4">
          {ranked.map((p, i) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 border-b border-white/5 pb-2 last:border-0"
            >
              <span className="text-sm text-slate-200">
                {i + 1}. {p.name}
              </span>
              <span className="font-mono text-sm font-bold text-sky-200">{p.score}</span>
            </div>
          ))}
        </section>
        <RoomPanel defaultName={session?.name ?? ""} />
      </div>
    );
  }

  if (!question) return null;

  // ── กำลังเล่น ────────────────────────────────────────────────────────────
  // กล่องของข้อก่อนหน้าอาจค้างมาชั่วครู่ระหว่างที่เจ้าภาพยังไม่ส่งชุดใหม่
  const liveMatches = !live?.questionId || live.questionId === question.id;
  const step = liveMatches ? (live?.step ?? "answering") : "answering";
  const cfg = snapshot.settings;
  const stageMs = (live?.durationMs ?? cfg.seconds[question.stage] * 1000) || 60_000;
  const remaining =
    liveMatches && live?.deadlineAt ? Math.max(0, live.deadlineAt - now) : 0;
  const activeName =
    snapshot.participants.find((p) => p.id === live?.activeParticipantId)?.name ?? null;

  const boxes: StageBox[] | null =
    liveMatches && live && live.boxes.length > 0
      ? live.boxes.map((b) => ({ id: b.id, label: b.label, text: b.text, zone: b.zone }))
      : null;
  const openedCount = live?.openedCount ?? boxes?.filter((b) => b.text !== null).length ?? 0;
  /**
   * ผลของ "คนที่ตอบข้อนี้" ไม่ใช่ผลแรกที่เจอ
   *
   * โหมดดวลบอทมีสองรายการต่อข้อ (ของคนกับของบอท) ถ้าหยิบอันแรกเฉย ๆ
   * จะเจอของใครก็ได้ตามลำดับที่บันทึกลงไป — ต้องยึดจากคนที่ถึงตาตอบ
   */
  const round = snapshot.roundLog.find(
    (r) =>
      r.questionId === question.id &&
      (!live?.activeParticipantId || r.participantId === live.activeParticipantId),
  );
  const botRound = snapshot.roundLog.find(
    (r) =>
      r.questionId === question.id &&
      r.participantId !== round?.participantId &&
      snapshot.participants.find((p) => p.id === r.participantId)?.kind === "bot",
  );

  return (
    <div className="space-y-4">
      <ScoreBoard
        activeId={live?.activeParticipantId ?? null}
        participants={snapshot.participants}
        maxTokens={cfg.maxTokens}
      />

      <QuestionMeta
        question={question}
        index={snapshot.currentQuestionIndex}
        total={snapshot.questions.length}
        activeLine={activeName ? `${activeName} ตอบข้อนี้` : "—"}
        remaining={remaining}
        totalMs={stageMs}
        timerLabel="เวลาที่เหลือ"
        paused={step === "grading" || step === "result"}
      />

      {/* ภาพโจทย์มาทางสถานะสด ไม่ใช่ทางสแนปช็อต — ดู RoomLive.imageUrl ว่าทำไม */}
      <QuestionPanel
        question={question}
        imageUrl={liveMatches ? (live?.imageUrl ?? null) : null}
      />

      {/* ── กล่องคำใบ้ — เห็นเท่ากับจอเจ้าภาพทุกกล่อง ต่างแค่กดเปิดไม่ได้ ── */}
      {step === "answering" || step === "performing" ? (
        <HintGrid
          boxes={boxes}
          boxCount={cfg.boxCount}
          maxOpen={cfg.maxOpenBoxes[question.stage]}
          openedCount={openedCount}
          costPct={Math.round(cfg.boxCostRatio * 100)}
          remainingPct={live?.remainingPct ?? 100}
          imageUrl={liveMatches ? (live?.imageUrl ?? null) : null}
          footer={
            <p className="text-xs text-slate-500">
              🔒 กดเปิดกล่องได้ที่จอเจ้าภาพ · ในกล่องมีทั้งใบ้จริงและใบ้หลอก
              ยังไม่เฉลยจนกว่าจะจบข้อ
            </p>
          }
        />
      ) : null}

      {/* คำใบ้ที่เปิดไว้ — ค้างบนจอจนขึ้นเฉลย ดูเหตุผลที่ OpenedHints */}
      {step !== "answering" && step !== "performing" && !(step === "result" && live?.reveal) ? (
        <OpenedHints
          boxes={(boxes ?? []).filter((b) => b.text !== null)}
          imageUrl={liveMatches ? (live?.imageUrl ?? null) : null}
        />
      ) : null}

      {/* ช่วยกันคิด — วางไว้ก่อนตัวเลือก/ช่องตอบ ลำดับเดียวกับจอเจ้าภาพ */}
      {step === "answering" || step === "performing" ? (
        <div className="space-y-2">
          <LiveDrafts questionId={question.id} onUse={useDraftText} />
          <TeammateNotes questionId={question.id} />
        </div>
      ) : null}

      {/* ── ปรนัย — เห็นตัวเลือกชุดเดียวกัน แต่กดไม่ได้ ─────────────────── */}
      {step === "answering" && question.format === "choice" ? (
        <div className="grid gap-2.5">
          {(question.choices ?? []).map((c) => (
            <div key={c} className="choice cursor-default opacity-75">
              {c}
            </div>
          ))}
        </div>
      ) : null}

      {/* ── กำลังตรวจ ───────────────────────────────────────────────────── */}
      {step === "grading" ? (
        <div className="panel flex flex-col items-center gap-3 p-8 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/15 border-t-sky-300" />
          <p className="text-sm text-slate-300">AI กำลังตรวจคำตอบตามเกณฑ์ของข้อนี้...</p>
        </div>
      ) : null}

      {/* ── ผลลัพธ์ — คะแนนและฟีดแบ็กอ่านจาก roundLog ในสแนปช็อต ────────── */}
      {step === "result" && round ? (
        <div
          className={`animate-popIn rounded-2xl border p-5 ${
            round.points > 0
              ? "border-teal-300/50 bg-teal-400/10"
              : "border-rose-400/50 bg-rose-500/10"
          }`}
        >
          <p className="text-lg font-bold">
            {round.timedOut
              ? `⏱️ ${activeName ?? ""} หมดเวลา`
              : round.points > 0
                ? `✅ ${activeName ?? ""} ได้คะแนน`
                : `❌ ${activeName ?? ""} ไม่ได้คะแนนข้อนี้`}
          </p>
          {question.format === "choice" && question.correctAnswer ? (
            <p className="mt-1 text-sm text-slate-300">
              คำตอบที่ถูกคือ <b className="text-white">{question.correctAnswer}</b>
            </p>
          ) : null}
          {round.feedback ? (
            <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{round.feedback}</p>
          ) : null}
          {live?.strengths?.length ? (
            <ul className="mt-2 space-y-1 text-xs text-teal-200">
              {live.strengths.map((s, i) => (
                <li key={i}>✔ {s}</li>
              ))}
            </ul>
          ) : null}
          {live?.improvements?.length ? (
            <ul className="mt-1 space-y-1 text-xs text-sky-200/80">
              {live.improvements.map((s, i) => (
                <li key={i}>↗ {s}</li>
              ))}
            </ul>
          ) : null}
          {question.explanation ? (
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              {question.explanation}
            </p>
          ) : null}
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
          <div className="mt-3 flex items-baseline gap-3">
            <span
              className={`tabular text-2xl font-extrabold ${
                round.points > 0 ? "text-teal-300" : "text-slate-400"
              }`}
            >
              +{round.points}
            </span>
            <span className="text-xs text-slate-500">
              (คุณภาพคำตอบ {round.quality}%
              {round.boxesOpened > 0
                ? ` · เปิด ${round.boxesOpened} กล่อง${
                    round.tokenSpent ? " · ใช้โทเคน 1" : ""
                  } → เหลือ ${live?.remainingPct ?? 100}%`
                : ""}
              )
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            ปุ่มไปข้อถัดไปอยู่ที่จอเจ้าภาพ
          </p>
        </div>
      ) : null}

      {/* บอทเจอโจทย์ข้อเดียวกันและตอบไปแล้ว — โชว์ให้ตรงกับจอเจ้าภาพ */}
      {step === "result" && botRound ? (
        <div className="rounded-2xl border border-stage-edge bg-white/[0.03] p-4">
          <p className="text-sm font-bold text-slate-200">
            🤖 {snapshot.participants.find((p) => p.id === botRound.participantId)?.name}{" "}
            เจอโจทย์ข้อเดียวกัน
          </p>
          <div className="mt-2 flex items-baseline gap-3">
            <span
              className={`tabular text-xl font-extrabold ${
                botRound.points > 0 ? "text-teal-300" : "text-slate-400"
              }`}
            >
              +{botRound.points}
            </span>
            <span className="text-xs text-slate-500">
              (คุณภาพคำตอบ {botRound.quality}%
              {botRound.boxesOpened > 0
                ? ` · เปิด ${botRound.boxesOpened} กล่อง`
                : " · ไม่เปิดกล่อง"}
              )
            </span>
          </div>
        </div>
      ) : null}

      {/* เฉลยกล่องทั้ง 4 — เพื่อนต้องได้อ่านเท่ากัน ไม่งั้นเล่นจบโดยไม่รู้ว่าโดนหลอกตรงไหน */}
      {step === "result" && liveMatches && live?.reveal?.length ? (
        <RevealList items={live.reveal} openedIds={live.openedIds ?? []} />
      ) : null}

      {/* ── ช่องพิมพ์ — ตำแหน่งเดียวกับช่องคำตอบของเจ้าภาพ ─────────────── */}
      {step === "answering" || step === "performing" ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_INTENT_LENGTH))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={5}
            placeholder="ช่วยคิดแล้วส่งขึ้นจอคนตอบ... เช่น กล่อง B น่าจะหลอก ตอบข้อ 3 เถอะ"
            className="field min-h-[130px] resize-y leading-relaxed"
          />
          <p className="text-xs text-slate-500">
            {sent
              ? "✓ ส่งไปขึ้นจอคนตอบแล้ว"
              : "คนกดส่งคำตอบจริงคือเจ้าภาพ · จอนี้ส่งความคิดไปช่วย"}
          </p>
        </div>
      ) : null}

      {/* ต้องเป็นลูกคนสุดท้ายของกล่องนอกสุด ไม่งั้น sticky ไม่มีที่ให้ติด */}
      <ActionBar
        counter={
          step === "answering" || step === "performing"
            ? `${draft.length}/${MAX_INTENT_LENGTH}`
            : ""
        }
      >
        {step === "answering" || step === "performing" ? (
          <button
            onClick={() => void handleSend()}
            disabled={sending || !draft.trim()}
            className="btn-primary flex-1 text-base sm:flex-none sm:px-8"
          >
            ส่งให้คนตอบ
          </button>
        ) : null}
      </ActionBar>
    </div>
  );
}
