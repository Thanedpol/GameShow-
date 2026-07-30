"use client";

import { useEffect, useState } from "react";
import RoomPanel from "./RoomPanel";
import TeammateNotes from "./TeammateNotes";
import { useRoom } from "@/lib/roomClient";
import { MAX_INTENT_LENGTH } from "@/lib/room";
import { STAGE_LABEL, rankParticipants } from "@/lib/scoring";

/**
 * จอของเพื่อนร่วมทีมที่ใช้อีกเครื่อง
 *
 * วาดจากสแนปช็อตที่เจ้าภาพส่งขึ้นห้อง ไม่มี state เกมของตัวเอง
 * ตั้งใจให้ "ดูได้ทุกอย่าง แต่กดตอบไม่ได้" — คนกดตอบมีคนเดียวคือเจ้าภาพ
 * จะได้ไม่เกิดกรณีสองคนกดพร้อมกันแล้วคะแนนเพี้ยน
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

  const liveDrafts = drafts.filter(
    (d) => d.questionId === (question?.id ?? null) && d.text.trim(),
  );

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

  // ── กำลังเล่น ────────────────────────────────────────────────────────────
  const secondsLeft = live?.deadlineAt
    ? Math.max(0, Math.ceil((live.deadlineAt - now) / 1000))
    : null;
  const activeName =
    snapshot.participants.find((p) => p.id === live?.activeParticipantId)?.name ?? null;
  const openedBoxes = (live?.boxes ?? []).filter((b) => b.text !== null);
  // กล่องของข้อก่อนหน้าอาจค้างมาชั่วครู่ระหว่างที่เจ้าภาพยังไม่ส่งชุดใหม่
  const liveMatchesQuestion = !live?.questionId || live.questionId === question?.id;

  return (
    <div className="animate-popIn space-y-4">
      <header className="flex items-center justify-between gap-3 pt-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-sky-300/80">
            โหมดติดตาม · ห้อง {session?.code}
          </p>
          <p className="mt-0.5 truncate text-sm font-bold text-white">
            {question ? STAGE_LABEL[question.stage] : "—"} · ข้อ{" "}
            {snapshot.currentQuestionIndex + 1}/{snapshot.questions.length}
          </p>
        </div>
        {secondsLeft !== null && liveMatchesQuestion ? (
          <div
            className={`shrink-0 rounded-2xl border px-4 py-2 text-center ${
              secondsLeft <= 10
                ? "border-rose-400/60 bg-rose-500/15"
                : "border-stage-edge bg-white/5"
            }`}
          >
            <p className="font-mono text-2xl font-extrabold text-white">{secondsLeft}</p>
            <p className="text-xs text-slate-400">วินาที</p>
          </div>
        ) : null}
      </header>

      {activeName ? (
        <p className="text-center text-xs text-slate-400">
          ตาของ <b className="text-sky-200">{activeName}</b> · กดตอบได้ที่จอเจ้าภาพเท่านั้น
        </p>
      ) : null}

      {question ? (
        <section className="panel space-y-3 p-4">
          <p className="text-base font-semibold leading-relaxed text-white">
            {question.prompt}
          </p>
          {question.choices?.length ? (
            <ul className="space-y-2">
              {question.choices.map((c) => (
                <li
                  key={c}
                  className="rounded-xl border border-stage-edge bg-white/[0.04] px-4 py-3 text-sm text-slate-100"
                >
                  {c}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {/* กล่องที่ทีมเปิดไปแล้ว — ข้อความจริงเห็นเหมือนกันทุกเครื่อง */}
      {liveMatchesQuestion && (live?.boxes.length ?? 0) > 0 ? (
        <section className="space-y-2">
          <h2 className="text-xs font-bold text-slate-300">
            กล่องคำใบ้ที่เปิดแล้ว ({openedBoxes.length}/{live?.boxes.length})
          </h2>
          {openedBoxes.length === 0 ? (
            <p className="rounded-xl border border-dashed border-sky-400/30 bg-white/[0.02] px-4 py-5 text-center text-xs text-slate-400">
              ยังไม่มีใครเปิดกล่อง — คุยกับเพื่อนก่อนว่าจะเปิดดีไหม
            </p>
          ) : (
            openedBoxes.map((b) => (
              <div
                key={b.id}
                className="rounded-xl border border-sky-400/40 bg-sky-500/10 px-4 py-3"
              >
                <p className="text-xs font-bold text-sky-300">กล่อง {b.label}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-100">{b.text}</p>
              </div>
            ))
          )}
          <p className="text-xs text-slate-500">
            ⚠️ ในกล่องมีทั้งใบ้จริงและใบ้หลอก ยังไม่เฉลยจนกว่าจะจบข้อ
          </p>
        </section>
      ) : null}

      <TeammateNotes questionId={question?.id ?? ""} />

      {/* ข้อความที่คนอื่นกำลังพิมพ์อยู่ตอนนี้ */}
      {liveDrafts.length > 0 ? (
        <section className="space-y-2 rounded-xl border border-teal-300/35 bg-teal-400/[0.07] p-3">
          <h2 className="text-xs font-bold text-teal-200">
            <span className="mr-1 inline-block animate-pulse">✍️</span>
            กำลังพิมพ์อยู่ตอนนี้
          </h2>
          {liveDrafts.map((d) => (
            <div
              key={d.memberId}
              className="rounded-lg border border-stage-edge bg-white/[0.04] p-2.5"
            >
              <p className="text-xs">
                <span className="font-semibold text-teal-200">{d.memberName}:</span>{" "}
                <span className="text-slate-100">{d.text}</span>
              </p>
              <button onClick={() => useDraftText(d.text)} className="btn-ghost mt-1.5 w-full text-xs">
                ↓ ดึงข้อความนี้มาใช้ต่อ
              </button>
            </div>
          ))}
        </section>
      ) : null}

      {/* ส่งความคิดให้คนที่กดตอบ */}
      <section className="panel space-y-2 p-3">
        <h2 className="text-xs font-bold text-white">ส่งความคิดให้เพื่อน</h2>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_INTENT_LENGTH))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={2}
          placeholder="เช่น กล่อง B น่าจะหลอก ตอบข้อ 3 เถอะ"
          className="field resize-none text-sm"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {sent ? "✓ ส่งไปขึ้นจอเพื่อนแล้ว" : "Enter เพื่อส่ง · Shift+Enter ขึ้นบรรทัดใหม่"}
          </span>
          <button
            onClick={() => void handleSend()}
            disabled={sending || !draft.trim()}
            className="btn-primary shrink-0 text-xs"
          >
            ส่ง
          </button>
        </div>
      </section>

      <section className="panel space-y-1.5 p-3">
        <h2 className="text-xs font-bold text-slate-300">คะแนนตอนนี้</h2>
        {snapshot.participants.map((p) => (
          <div key={p.id} className="flex justify-between gap-3 text-xs">
            <span className="truncate text-slate-200">{p.name}</span>
            <span className="font-mono font-bold text-sky-200">{p.score}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
