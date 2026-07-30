"use client";

import TimerRing from "./TimerRing";
import { useRoom } from "@/lib/roomClient";
import { STAGE_LABEL } from "@/lib/scoring";
import { ZONE_POSITION } from "@/lib/types";
import type { HintZone, Question } from "@/lib/types";

/**
 * ชิ้นส่วนหน้าจอ "ระหว่างเล่น" ที่ทุกเครื่องในห้องใช้ร่วมกัน
 *
 * เดิมจอเจ้าภาพ (QuestionScreen) กับจอเพื่อน (FollowerScreen) ต่างคนต่างวาด
 * หน้าตาของตัวเอง ผลคือสองจอไม่เหมือนกันเลยทั้งที่เล่นเกมเดียวกันอยู่ —
 * เจ้าภาพได้แถบคะแนน ชิปบอกช่วง วงแหวนนับถอยหลัง และกล่องคำใบ้เรียงสี่ช่อง
 * ส่วนเพื่อนได้หัวข้อเล็ก ๆ กับกล่องสี่เหลี่ยมบอกวินาที คนละแอปกันไปเลย
 *
 * ย้ายมาไว้ที่เดียวเพื่อให้แก้ครั้งเดียวแล้วเปลี่ยนทั้งสองจอพร้อมกัน
 * ไม่ใช่ก๊อปไป-มาแล้วค่อย ๆ เพี้ยนออกจากกันอีก
 *
 * ตัวที่ต่างกันได้มีอย่างเดียวคือ "กดได้ไหม" — เจ้าภาพเป็นคนกดเปิดกล่องและกดตอบ
 * จอเพื่อนเห็นทุกอย่างเท่ากันแต่กดไม่ได้ จึงเป็นแค่ prop ไม่ใช่คนละหน้าจอ
 */

/** กล่องคำใบ้ในรูปแบบที่ใช้วาดได้ทั้งสองจอ — `text: null` = ยังไม่เปิด */
export interface StageBox {
  id: string;
  label: string;
  text: string | null;
  zone?: HintZone | null;
}

/**
 * เนื้อในกล่องคำใบ้ — เป็นข้อความเปล่า หรือข้อความ + ภาพซูมเฉพาะโซน
 *
 * กล่องภาพไม่ได้วาดภาพใหม่ แต่ซูมเข้าไปที่โซนหนึ่งของภาพประกอบคำถาม
 * ประหยัดทั้งเงิน (ภาพละราว 2.4 บาท) และเวลา (อีกภาพละ 5 วินาที)
 * โดยยังได้คำใบ้เชิงภาพจริง ๆ — กล่องจริงชี้ถูกโซน กล่องหลอกชี้ผิดโซน
 */
export function HintBoxBody({
  text,
  zone,
  imageUrl,
}: {
  text: string;
  zone?: HintZone | null;
  imageUrl?: string | null;
}) {
  return (
    <>
      <p className="mt-1.5 text-xs leading-relaxed text-white">{text}</p>
      {zone && imageUrl ? (
        <div className="mt-2">
          <div className="h-24 w-full overflow-hidden rounded-lg border border-white/15">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={`ซูมภาพโซน${zone}`}
              style={{ objectPosition: ZONE_POSITION[zone] }}
              className="h-full w-full scale-[2.2] object-cover"
            />
          </div>
          <p className="mt-1 text-center text-xs text-sky-200/80">🔍 ซูมโซน{zone}ของภาพ</p>
        </div>
      ) : null}
    </>
  );
}

/**
 * แถบบนสุดของข้อ — ชิปบอกช่วง/หมวด/รูปแบบ/คะแนน + เลขข้อ + วงแหวนนับถอยหลัง
 *
 * วงแหวนต้องรับเวลาเป็น ms ที่เหลือกับเวลาเต็ม ไม่ใช่วินาทีดิบ ๆ
 * จอเพื่อนจึงคำนวณจาก `deadlineAt` ที่เจ้าภาพส่งมา (เวลาปลายทางจริง)
 * แทนที่จะนับถอยหลังเอง จะได้ไม่เพี้ยนตามดีเลย์เครือข่าย
 */
export function QuestionMeta({
  question,
  index,
  total,
  activeLine,
  remaining,
  totalMs,
  timerLabel,
  paused,
}: {
  question: Question;
  index: number;
  total: number;
  activeLine: string;
  remaining: number;
  totalMs: number;
  timerLabel: string;
  paused?: boolean;
}) {
  const formatLabel =
    question.format === "choice"
      ? "ปรนัย"
      : question.format === "open"
        ? "อัตนัย · พิมพ์ตอบ"
        : "โชว์ความสามารถ";

  return (
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
          ข้อ {index + 1} / {total} ·{" "}
          <span className="font-semibold text-slate-200">{activeLine}</span>
        </p>
      </div>
      <TimerRing
        remaining={remaining}
        total={totalMs}
        label={timerLabel}
        paused={paused}
      />
    </div>
  );
}

/**
 * ตัวโจทย์
 *
 * `imageUrl` แยกเป็น prop ไม่ได้อ่านจาก `question.imageUrl` ตรง ๆ เพราะสแนปช็อต
 * ที่ส่งข้ามเครื่องถูกตัดภาพออก (ดู stripHeavyFields) จอเพื่อนจึงต้องส่งภาพย่อ
 * ที่มากับสถานะสดเข้ามาแทน ส่วนเจ้าภาพส่ง question.imageUrl ของตัวเองมาตามปกติ
 */
export function QuestionPanel({
  question,
  imageUrl,
}: {
  question: Question;
  imageUrl?: string | null;
}) {
  return (
    <div className="panel animate-popIn p-5">
      <h2 className="text-xl font-bold leading-relaxed sm:text-2xl">{question.prompt}</h2>
      {question.task ? (
        <p className="mt-3 whitespace-pre-line rounded-xl bg-white/[0.05] p-3 text-sm leading-relaxed text-slate-300">
          {question.task}
        </p>
      ) : null}
      {/* โจทย์หาจุดผิดจากภาพ — ภาพคือตัวโจทย์ ไม่ใช่ของประดับ จึงวางใหญ่ไว้ตรงนี้ */}
      {imageUrl ? (
        <figure className="mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="ภาพประกอบโจทย์ — หาจุดที่ผิดในภาพนี้"
            className="w-full rounded-xl border border-stage-edge bg-white/[0.03]"
          />
          <figcaption className="mt-1.5 text-center text-xs text-slate-500">
            ภาพนี้สร้างด้วย AI และมีจุดที่ผิดอยู่ — หาให้เจอก่อนหมดเวลา
          </figcaption>
        </figure>
      ) : null}
    </div>
  );
}

/**
 * กล่องคำใบ้ทั้งแถว พร้อมหัวข้อบอกโควตาและคะแนนที่เหลือ
 *
 * `onOpen` ไม่ส่งมา = จอที่กดไม่ได้ — วาดเหมือนกันทุกอย่างแต่เป็น div ไม่ใช่ปุ่ม
 * ต้องหรี่เองด้วย opacity เพราะ `.hint-box` หรี่ผ่าน `:disabled` ซึ่ง div ไม่มี
 * ถ้าไม่หรี่ จอเพื่อนจะสว่างกว่าจอเจ้าภาพตอนเปิดครบโควตาแล้ว
 */
export function HintGrid({
  boxes,
  boxCount,
  maxOpen,
  openedCount,
  costPct,
  remainingPct,
  imageUrl,
  onOpen,
  footer,
}: {
  boxes: StageBox[] | null;
  boxCount: number;
  maxOpen: number;
  openedCount: number;
  costPct: number;
  remainingPct: number;
  imageUrl?: string | null;
  onOpen?: (id: string) => void;
  footer?: React.ReactNode;
}) {
  const limitReached = openedCount >= maxOpen;
  const slots: Array<StageBox | undefined> =
    boxes && boxes.length > 0 ? boxes : Array.from({ length: boxCount });

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-200">
          กล่องคำใบ้ {boxCount} กล่อง ·{" "}
          <span className={limitReached ? "text-cyan-200" : ""}>
            ช่วงนี้เปิดได้ {maxOpen} กล่อง (เปิดแล้ว {openedCount})
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

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {slots.map((b, i) => {
          if (b && b.text !== null) {
            return (
              <div
                key={b.id}
                className="animate-popIn rounded-2xl border border-sky-400/50 bg-sky-500/10 p-3"
              >
                <span className="chip bg-white/10 px-2 py-0.5 text-xs text-slate-200">
                  กล่อง {b.label}
                </span>
                <HintBoxBody text={b.text} zone={b.zone} imageUrl={imageUrl} />
              </div>
            );
          }

          const face = !b ? "⏳" : limitReached ? "🔒" : "🎁";
          const title = b ? `กล่อง ${b.label}` : "กำลังเตรียม";
          const note = !b ? "" : limitReached ? "ครบโควตาแล้ว" : `−${costPct}%`;
          const inner = (
            <>
              <span className="text-2xl" aria-hidden="true">
                {face}
              </span>
              <span className="text-xs font-bold text-sky-100">{title}</span>
              <span className="text-xs text-slate-400">{note}</span>
            </>
          );

          if (!onOpen) {
            return (
              <div
                key={b?.id ?? i}
                aria-disabled="true"
                className={`hint-box ${!b || limitReached ? "opacity-45" : ""}`}
              >
                {inner}
              </div>
            );
          }
          return (
            <button
              key={b?.id ?? i}
              onClick={() => b && onOpen(b.id)}
              disabled={!b || limitReached}
              className="hint-box"
            >
              {inner}
            </button>
          );
        })}
      </div>

      {footer}
    </section>
  );
}

/**
 * คำใบ้ที่เปิดไว้ — ค้างบนจอตั้งแต่กดตอบจนขึ้นเฉลย
 *
 * ผู้เล่นจ่ายคะแนนไปแล้วเพื่อเปิดกล่องนี้ ถ้ามันหายไปตอนกดตอบ
 * ก็เท่ากับจ่ายแล้วอ่านไม่ทัน ตรงนี้จึงต้องอยู่ต่อจนกว่าจะขึ้นเฉลย
 * (ตอนกำลังตอบอยู่ กริดกล่องแสดงให้แล้ว ไม่ต้องซ้ำ)
 */
export function OpenedHints({
  boxes,
  imageUrl,
}: {
  boxes: StageBox[];
  imageUrl?: string | null;
}) {
  if (boxes.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-bold text-slate-200">คำใบ้ที่เปิดไว้</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {boxes.map((b) => (
          <div
            key={b.id}
            className="rounded-2xl border border-sky-400/50 bg-sky-500/10 p-3"
          >
            <span className="chip bg-white/10 px-2 py-0.5 text-xs text-slate-200">
              กล่อง {b.label}
            </span>
            <HintBoxBody text={b.text ?? ""} zone={b.zone} imageUrl={imageUrl} />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * เฉลยกล่องคำใบ้ทั้งสี่ตอนจบข้อ
 *
 * เป็นส่วนที่เกมสอนจริง ๆ — ไม่ใช่แค่บอกว่าใครถูก แต่บอกว่ากล่องหลอกหลอกยังไง
 * ทุกเครื่องในห้องต้องได้อ่านเท่ากัน ไม่ใช่เฉพาะคนที่ถือรีโมต
 */
export interface StageReveal {
  id: string;
  label: string;
  text: string;
  truth: string;
  rationale: string;
}

export function RevealList({
  items,
  openedIds,
}: {
  items: StageReveal[];
  openedIds: string[];
}) {
  return (
    <div className="panel space-y-2 p-4">
      <h3 className="text-sm font-bold text-slate-200">เฉลยกล่องคำใบ้ทั้งหมด</h3>
      {items.map((b) => {
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
              <span className="chip bg-white/10 px-2 py-0.5 text-xs text-slate-200">
                กล่อง {b.label}
              </span>
              <span
                className={`chip px-2 py-0.5 text-xs ${
                  b.truth === "จริง"
                    ? "bg-teal-400/25 text-teal-100"
                    : "bg-rose-500/25 text-rose-100"
                }`}
              >
                {b.truth === "จริง" ? "✅ ใบ้จริง" : "🎭 ใบ้หลอก"}
              </span>
              {wasOpened ? (
                <span className="chip bg-sky-500/20 px-2 py-0.5 text-xs text-sky-100">
                  คุณเปิดกล่องนี้
                </span>
              ) : null}
            </div>
            <p className="text-xs leading-relaxed text-white">{b.text}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              <b className="text-slate-300">ทำไมถึงใบ้แบบนี้:</b> {b.rationale}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/**
 * แถบปุ่มลงมือที่ติดขอบล่างจอ
 *
 * วัดจริงบนมือถือแนวนอน (812x375) แล้วเจอว่าปุ่ม "ส่งคำตอบ" อยู่ที่ y=769
 * แปลว่าต้องเลื่อนลง 2.3 เท่าของความสูงจอกว่าจะกดได้ ทั้งที่นาฬิกาเดินอยู่
 * ในเกมจับเวลา การทำให้ปุ่มตอบไปไม่ถึงคือการลงโทษผู้เล่นด้วยเรื่องที่ไม่ใช่ความรู้
 *
 * จึงตรึงไว้ล่างจอ พร้อมพื้นทึบและเงาบนขอบ เพื่อไม่ให้เนื้อหาที่เลื่อนผ่าน
 * ด้านหลังอ่านทะลุออกมา · เผื่อ safe-area ของมือถือที่มีแถบขีดล่างด้วย
 *
 * ต้องเป็นลูกคนสุดท้ายของกล่องนอกสุดเสมอ ไม่ใช่ซ่อนอยู่ในบล็อกย่อย
 * เพราะ sticky ยึดกับ "กล่องแม่" ถ้าแม่เตี้ยกว่าจอ มันก็ไม่มีที่ให้ติด
 */
export function ActionBar({
  counter,
  children,
}: {
  counter?: string;
  children: React.ReactNode;
}) {
  // ไม่มีปุ่มก็ไม่ต้องมีแถบ ไม่งั้นจะเหลือขอบเส้นลอย ๆ กินที่ล่างจอเปล่า ๆ
  const hasAction = Array.isArray(children) ? children.some(Boolean) : Boolean(children);
  if (!hasAction) return null;

  return (
    <div
      className="sticky bottom-0 z-20 -mx-4 mt-2 border-t border-stage-edge/70
                 bg-stage-bg/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]
                 pt-3 backdrop-blur sm:-mx-6 sm:px-6"
    >
      <div className="flex items-center justify-between gap-3">
        {counter ? (
          <span className="shrink-0 text-xs tabular text-slate-500">{counter}</span>
        ) : null}
        <div className="flex flex-1 items-center justify-end gap-2">{children}</div>
      </div>
    </div>
  );
}

/**
 * ข้อความที่เพื่อนร่วมทีมกำลังพิมพ์อยู่ตอนนี้ พร้อมปุ่มดึงมาต่อท้ายของตัวเอง
 *
 * ต่างจาก TeammateNotes ที่แสดงของที่ "ส่งแล้ว" — อันนี้คือของที่ยังพิมพ์ไม่จบ
 * มีไว้ให้เห็นว่าอีกฝ่ายเขียนถึงไหน จะได้ไม่พิมพ์เรื่องเดียวกันซ้อนกัน
 * ตามหลังจริงราว 1-2 วินาทีเพราะระบบ poll ทุก 1.5 วิ ไม่ใช่ทีละตัวอักษร
 */
export function LiveDrafts({
  questionId,
  onUse,
}: {
  questionId: string;
  onUse: (text: string) => void;
}) {
  const { drafts } = useRoom();
  const current = drafts.filter((d) => d.questionId === questionId && d.text.trim());
  if (current.length === 0) return null;

  return (
    <section className="space-y-2 rounded-xl border border-teal-300/35 bg-teal-400/[0.07] p-3">
      <h3 className="text-xs font-bold text-teal-200">
        <span className="mr-1 inline-block animate-pulse">✍️</span>
        กำลังพิมพ์อยู่ตอนนี้
      </h3>
      {current.map((d) => (
        <div key={d.memberId} className="rounded-lg border border-stage-edge bg-white/[0.04] p-2.5">
          <p className="text-xs">
            <span className="font-semibold text-teal-200">{d.memberName}:</span>{" "}
            <span className="text-slate-100">{d.text}</span>
          </p>
          <button onClick={() => onUse(d.text)} className="btn-ghost mt-1.5 w-full text-xs">
            ↓ ดึงข้อความนี้มาใช้ต่อ
          </button>
        </div>
      ))}
    </section>
  );
}
