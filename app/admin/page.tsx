"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { QUESTION_BANK } from "@/lib/questions";
import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_SETTINGS,
  isUsingCustomQuestions,
  loadLlmSettings,
  loadQuestions,
  loadSettings,
  resetLlmSettings,
  resetQuestions,
  resetSettings,
  sanitizeQuestion,
  saveLlmSettings,
  saveQuestions,
  saveSettings,
  type GameSettings,
  type LlmProviderChoice,
  type LlmSettings,
} from "@/lib/settings";
import type { AdminConfigResponse } from "@/app/api/admin/config/route";
import type { AdminModelsResponse } from "@/app/api/admin/models/route";
import type { Category, Difficulty, Question, QuestionFormat, Stage } from "@/lib/types";

type Tab = "questions" | "rules" | "api";

const STAGES: Stage[] = ["warmup", "push", "final"];
const FORMATS: QuestionFormat[] = ["choice", "open", "performance"];
const DIFFS: Difficulty[] = ["ง่าย", "กลาง", "ยาก"];
const CATEGORIES: Category[] = [
  "สแกม",
  "การเงิน",
  "AI",
  "สุขภาพ",
  "ที่ทำงาน",
  "ชีวิตจริง",
  "สื่อสาร",
  "ตรรกะ",
];

const STAGE_TH: Record<Stage, string> = {
  warmup: "Warm-Up",
  push: "Push Your Luck",
  final: "AI Duel Final",
};
const FORMAT_TH: Record<QuestionFormat, string> = {
  choice: "ปรนัย",
  open: "อัตนัย",
  performance: "โชว์ความสามารถ",
};

function blankQuestion(): Question {
  return {
    id: `custom-${Date.now().toString(36)}`,
    category: "ชีวิตจริง",
    stage: "warmup",
    difficulty: "กลาง",
    format: "choice",
    pointValue: 100,
    prompt: "",
    choices: ["", "", "", ""],
    correctAnswer: "",
  };
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("questions");
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  };

  return (
    <div className="space-y-5 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-3 pt-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-sky-300/80">
            หลังบ้าน
          </p>
          <h1 className="mt-1 text-2xl font-extrabold text-white sm:text-3xl">
            ตั้งค่าเกม
          </h1>
        </div>
        <Link href="/" className="btn-ghost text-sm">
          ← กลับไปหน้าเกม
        </Link>
      </header>

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["questions", "คำถาม"],
            ["rules", "กติกา"],
            ["api", "API"],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
              tab === key
                ? "border-sky-400/80 bg-sky-500/20 text-sky-100"
                : "border-stage-edge bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {toast ? (
        <div className="rounded-xl border border-teal-300/50 bg-teal-400/10 px-4 py-3 text-sm text-teal-100">
          {toast}
        </div>
      ) : null}

      {tab === "questions" ? <QuestionsTab onFlash={flash} /> : null}
      {tab === "rules" ? <RulesTab onFlash={flash} /> : null}
      {tab === "api" ? <ApiTab onFlash={flash} /> : null}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// แท็บคำถาม
// ════════════════════════════════════════════════════════════════════════════

function QuestionsTab({ onFlash }: { onFlash: (m: string) => void }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [custom, setCustom] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Stage | "all">("all");
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setQuestions(loadQuestions());
    setCustom(isUsingCustomQuestions());
  }, []);

  const persist = (next: Question[]) => {
    setQuestions(next);
    saveQuestions(next);
    setCustom(true);
  };

  const counts = useMemo(() => {
    const byStage = { warmup: 0, push: 0, final: 0 } as Record<Stage, number>;
    const byFormat = { choice: 0, open: 0, performance: 0 } as Record<QuestionFormat, number>;
    for (const q of questions) {
      byStage[q.stage] += 1;
      byFormat[q.format] += 1;
    }
    return { byStage, byFormat };
  }, [questions]);

  const shown = questions.filter((q) => filter === "all" || q.stage === filter);

  function handleExport() {
    const blob = new Blob([JSON.stringify(questions, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "baijing-questions.json";
    a.click();
    URL.revokeObjectURL(url);
    onFlash(`ดาวน์โหลดคลังคำถาม ${questions.length} ข้อแล้ว`);
  }

  async function handleImport(file: File) {
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error("ไม่ใช่ array");
      const cleaned = parsed
        .map(sanitizeQuestion)
        .filter((q): q is Question => q !== null);
      if (cleaned.length === 0) throw new Error("ไม่มีข้อที่ใช้ได้");
      persist(cleaned);
      onFlash(`นำเข้า ${cleaned.length} ข้อสำเร็จ (ข้อที่ข้อมูลไม่ครบถูกข้ามไป)`);
    } catch (e) {
      onFlash(`นำเข้าไม่สำเร็จ: ${String(e)}`);
    }
  }

  return (
    <div className="space-y-4">
      <section className="panel space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-white">
              คลังคำถาม {questions.length} ข้อ
            </p>
            <p className="text-[11px] text-slate-400">
              {STAGES.map((s) => `${STAGE_TH[s]} ${counts.byStage[s]}`).join(" · ")} |{" "}
              {FORMATS.map((f) => `${FORMAT_TH[f]} ${counts.byFormat[f]}`).join(" · ")}
            </p>
          </div>
          <span
            className={`chip ${
              custom ? "bg-cyan-400/20 text-cyan-100" : "bg-white/10 text-slate-300"
            }`}
          >
            {custom ? "ใช้คลังที่แก้เอง" : "ใช้คลังตั้งต้น"}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              const q = blankQuestion();
              persist([q, ...questions]);
              setEditingId(q.id);
            }}
            className="btn-primary px-4 py-2 text-sm"
          >
            + เพิ่มคำถาม
          </button>
          <button onClick={handleExport} className="btn-ghost px-4 py-2 text-sm">
            Export JSON
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="btn-ghost px-4 py-2 text-sm"
          >
            Import JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImport(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => {
              if (
                !window.confirm(
                  `คืนค่าคลังคำถามกลับเป็นชุดตั้งต้น ${QUESTION_BANK.length} ข้อ?`,
                )
              )
                return;
              resetQuestions();
              setQuestions(QUESTION_BANK);
              setCustom(false);
              onFlash("คืนค่าคลังคำถามเป็นชุดตั้งต้นแล้ว");
            }}
            className="btn-ghost px-4 py-2 text-sm text-rose-200"
          >
            คืนค่าตั้งต้น
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(["all", ...STAGES] as Array<Stage | "all">).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`chip border transition ${
                filter === s
                  ? "border-sky-400/70 bg-sky-500/20 text-sky-100"
                  : "border-stage-edge bg-white/5 text-slate-400 hover:bg-white/10"
              }`}
            >
              {s === "all" ? "ทั้งหมด" : STAGE_TH[s]}
            </button>
          ))}
        </div>
      </section>

      {shown.map((q) =>
        editingId === q.id ? (
          <QuestionEditor
            key={q.id}
            question={q}
            onCancel={() => setEditingId(null)}
            onSave={(next) => {
              persist(questions.map((x) => (x.id === q.id ? next : x)));
              setEditingId(null);
              onFlash("บันทึกคำถามแล้ว");
            }}
          />
        ) : (
          <article key={q.id} className="panel p-4">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <span className="chip bg-indigo-500/20 text-indigo-200">
                {STAGE_TH[q.stage]}
              </span>
              <span className="chip bg-sky-500/15 text-sky-200">{FORMAT_TH[q.format]}</span>
              <span className="chip bg-white/10 text-slate-300">{q.category}</span>
              <span className="chip bg-teal-400/15 text-teal-200">{q.difficulty}</span>
              <span className="chip bg-cyan-400/15 text-cyan-100">{q.pointValue}</span>
            </div>
            <p className="text-sm leading-relaxed text-slate-100">{q.prompt}</p>
            {q.format === "choice" ? (
              <p className="mt-1 text-[11px] text-slate-400">
                เฉลย: <b className="text-teal-200">{q.correctAnswer}</b> ·{" "}
                {q.choices?.length ?? 0} ตัวเลือก
              </p>
            ) : null}
            <div className="mt-2.5 flex gap-2">
              <button
                onClick={() => setEditingId(q.id)}
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                แก้ไข
              </button>
              <button
                onClick={() => {
                  if (!window.confirm(`ลบข้อ "${q.prompt.slice(0, 30)}..." ?`)) return;
                  persist(questions.filter((x) => x.id !== q.id));
                  onFlash("ลบคำถามแล้ว");
                }}
                className="btn-ghost px-3 py-1.5 text-xs text-rose-200"
              >
                ลบ
              </button>
            </div>
          </article>
        ),
      )}
    </div>
  );
}

function QuestionEditor({
  question,
  onSave,
  onCancel,
}: {
  question: Question;
  onSave: (q: Question) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Question>({
    ...question,
    choices: question.choices ?? ["", "", "", ""],
  });
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Question>(key: K, value: Question[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  function handleSave() {
    const cleaned = sanitizeQuestion(draft);
    if (!cleaned) {
      setError(
        draft.format === "choice"
          ? "ข้อปรนัยต้องมีคำถาม อย่างน้อย 2 ตัวเลือก และเฉลยต้องตรงกับตัวเลือกใดตัวเลือกหนึ่ง"
          : "ต้องกรอกคำถามให้ครบก่อน",
      );
      return;
    }
    onSave(cleaned);
  }

  return (
    <div className="panel space-y-3 border-sky-400/60 p-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select label="ช่วง" value={draft.stage} options={STAGES} labels={STAGE_TH} onChange={(v) => set("stage", v as Stage)} />
        <Select label="รูปแบบ" value={draft.format} options={FORMATS} labels={FORMAT_TH} onChange={(v) => set("format", v as QuestionFormat)} />
        <Select label="หมวด" value={draft.category} options={CATEGORIES} onChange={(v) => set("category", v as Category)} />
        <Select label="ระดับ" value={draft.difficulty} options={DIFFS} onChange={(v) => set("difficulty", v as Difficulty)} />
      </div>

      <Field label="คะแนน">
        <input
          type="number"
          value={draft.pointValue}
          onChange={(e) => set("pointValue", Number(e.target.value))}
          className="field"
        />
      </Field>

      <Field label="คำถาม">
        <textarea
          value={draft.prompt}
          onChange={(e) => set("prompt", e.target.value)}
          rows={3}
          className="field resize-y"
        />
      </Field>

      {draft.format === "choice" ? (
        <>
          <Field label="ตัวเลือก (เว้นว่างได้ถ้าไม่ใช้)">
            <div className="space-y-2">
              {(draft.choices ?? []).map((c, i) => (
                <input
                  key={i}
                  value={c}
                  onChange={(e) => {
                    const next = [...(draft.choices ?? [])];
                    next[i] = e.target.value;
                    set("choices", next);
                  }}
                  placeholder={`ตัวเลือกที่ ${i + 1}`}
                  className="field text-sm"
                />
              ))}
            </div>
          </Field>
          <Field label="คำตอบที่ถูก">
            <select
              value={draft.correctAnswer ?? ""}
              onChange={(e) => set("correctAnswer", e.target.value)}
              className="field"
            >
              <option value="">— เลือกเฉลย —</option>
              {(draft.choices ?? [])
                .filter((c) => c.trim())
                .map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
            </select>
          </Field>
        </>
      ) : (
        <>
          {draft.format === "performance" ? (
            <Field label="โจทย์ที่ต้องแสดง (task)">
              <textarea
                value={draft.task ?? ""}
                onChange={(e) => set("task", e.target.value)}
                rows={3}
                className="field resize-y text-sm"
              />
            </Field>
          ) : null}
          <Field label="เกณฑ์ให้คะแนน (rubric) — AI ใช้ตรวจ">
            <textarea
              value={draft.rubric ?? ""}
              onChange={(e) => set("rubric", e.target.value)}
              rows={4}
              className="field resize-y text-sm"
            />
          </Field>
          {draft.format === "open" ? (
            <Field label="ประเด็นที่คำตอบดีควรมี (บรรทัดละ 1 ข้อ)">
              <textarea
                value={(draft.keyPoints ?? []).join("\n")}
                onChange={(e) =>
                  set(
                    "keyPoints",
                    e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                  )
                }
                rows={4}
                className="field resize-y text-sm"
              />
            </Field>
          ) : null}
        </>
      )}

      <div className="rounded-xl border border-cyan-300/30 bg-cyan-400/[0.06] p-3">
        <p className="mb-2 text-[11px] leading-relaxed text-cyan-100">
          คำใบ้ของข้อนี้ — บรรทัดละ 1 อัน ควรมีอย่างละ 3 อัน
          เพราะกล่องหนึ่งข้อสุ่มได้สูงสุด 3 กล่องต่อฝั่ง
          <br />
          ใช้ตรง ๆ ในโหมดสำรอง และเป็นตัวอย่างน้ำเสียงให้ AI ตอนมี API key
        </p>
        <div className="space-y-2">
          <Field label="ใบ้จริง — ชี้ทางด้วยหลักการ ไม่เฉลย ไม่ใบ้จากรูปคำ">
            <textarea
              value={(draft.hints?.real ?? []).join("\n")}
              onChange={(e) =>
                set("hints", {
                  real: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                  fake: draft.hints?.fake ?? [],
                })
              }
              rows={3}
              placeholder="เช่น ตัวที่ตอบเป็นโรงงานเคมีของร่างกาย น้ำดีเป็นแค่งานหนึ่งของมัน"
              className="field resize-y text-xs"
            />
          </Field>
          <Field label="ใบ้หลอก — ท่อนแรกจริง ท่อนหลังฟังดูน่าเชื่อแต่ผิด (ห้ามอ้างแหล่งปลอม)">
            <textarea
              value={(draft.hints?.fake ?? []).join("\n")}
              onChange={(e) =>
                set("hints", {
                  real: draft.hints?.real ?? [],
                  fake: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                })
              }
              rows={3}
              placeholder="เช่น น้ำดีช่วยย่อยไขมันจริง และมันถูกสร้างในถุงรูปลูกแพร์ใต้ชายโครงขวา"
              className="field resize-y text-xs"
            />
          </Field>
        </div>
      </div>

      <Field label="คำอธิบายเฉลย (ไม่บังคับ)">
        <textarea
          value={draft.explanation ?? ""}
          onChange={(e) => set("explanation", e.target.value)}
          rows={2}
          className="field resize-y text-sm"
        />
      </Field>

      {error ? (
        <p className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button onClick={handleSave} className="btn-primary px-5 py-2 text-sm">
          บันทึก
        </button>
        <button onClick={onCancel} className="btn-ghost px-5 py-2 text-sm">
          ยกเลิก
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// แท็บกติกา
// ════════════════════════════════════════════════════════════════════════════

function RulesTab({ onFlash }: { onFlash: (m: string) => void }) {
  const [s, setS] = useState<GameSettings>(DEFAULT_SETTINGS);

  useEffect(() => setS(loadSettings()), []);

  const total = s.counts.warmup + s.counts.push + s.counts.final;
  const totalSeconds = STAGES.reduce((sum, st) => sum + s.counts[st] * s.seconds[st], 0);

  return (
    <div className="space-y-4">
      <section className="panel space-y-3 p-4">
        <h2 className="text-sm font-bold text-white">กล่องคำใบ้ (ใช้ร่วมทุกช่วง)</h2>
        <div className="grid grid-cols-3 gap-3">
          <Field label="จำนวนกล่องที่วาง">
            <input
              type="number"
              min={2}
              max={6}
              value={s.boxCount}
              onChange={(e) => setS({ ...s, boxCount: Number(e.target.value) })}
              className="field"
            />
          </Field>
          <Field label="หักต่อ 1 กล่อง (%)">
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round(s.boxCostRatio * 100)}
              onChange={(e) => setS({ ...s, boxCostRatio: Number(e.target.value) / 100 })}
              className="field"
            />
          </Field>
          <Field label="โทเคนสูงสุด">
            <input
              type="number"
              min={0}
              max={9}
              value={s.maxTokens}
              onChange={(e) => setS({ ...s, maxTokens: Number(e.target.value) })}
              className="field"
            />
          </Field>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          กล่องที่วางไว้จะมีทั้งใบ้จริงและใบ้หลอกอย่างน้อยอย่างละ 1 เสมอ
          ส่วนจะเปิดได้กี่กล่องกำหนดแยกตามช่วงด้านล่าง
        </p>
      </section>

      <section className="panel space-y-3 p-4">
        <h2 className="text-sm font-bold text-white">ตั้งค่าแยกตามช่วง</h2>
        {STAGES.map((stage) => {
          const remain = Math.max(
            0,
            Math.round((1 - s.boxCostRatio * s.maxOpenBoxes[stage]) * 100),
          );
          return (
            <div key={stage} className="rounded-xl border border-stage-edge/70 p-3">
              <p className="mb-2 text-xs font-bold text-sky-200">{STAGE_TH[stage]}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Field label="ใช้กี่ข้อ">
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={s.counts[stage]}
                    onChange={(e) =>
                      setS({
                        ...s,
                        counts: { ...s.counts, [stage]: Number(e.target.value) },
                      })
                    }
                    className="field"
                  />
                </Field>
                <Field label="วินาที/ข้อ">
                  <input
                    type="number"
                    min={5}
                    max={600}
                    value={s.seconds[stage]}
                    onChange={(e) =>
                      setS({
                        ...s,
                        seconds: { ...s.seconds, [stage]: Number(e.target.value) },
                      })
                    }
                    className="field"
                  />
                </Field>
                <Field label="เปิดกล่องได้">
                  <input
                    type="number"
                    min={0}
                    max={s.boxCount}
                    value={s.maxOpenBoxes[stage]}
                    onChange={(e) =>
                      setS({
                        ...s,
                        maxOpenBoxes: {
                          ...s.maxOpenBoxes,
                          [stage]: Number(e.target.value),
                        },
                      })
                    }
                    className="field"
                  />
                </Field>
                <Field label="คะแนน/ข้อ">
                  <input
                    type="number"
                    min={0}
                    value={s.points[stage]}
                    onChange={(e) =>
                      setS({
                        ...s,
                        points: { ...s.points, [stage]: Number(e.target.value) },
                      })
                    }
                    className="field"
                  />
                </Field>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                เปิดครบโควตา {s.maxOpenBoxes[stage]} กล่อง จะเหลือ{" "}
                <b className="text-slate-200">{remain}%</b> ของคะแนนข้อนั้น
              </p>
            </div>
          );
        })}
        <p className="text-[11px] text-slate-400">
          รวม <b className="text-slate-200">{total} ข้อ</b> ต่อ 1 เกม · เวลาเล่นประมาณ{" "}
          <b className="text-slate-200">{Math.round(totalSeconds / 60)} นาที</b>
        </p>
      </section>

      <div className="flex gap-2">
        <button
          onClick={() => {
            saveSettings(s);
            onFlash("บันทึกกติกาแล้ว — จะมีผลกับเกมรอบถัดไปที่กดเริ่ม");
          }}
          className="btn-primary flex-1"
        >
          บันทึกกติกา
        </button>
        <button
          onClick={() => {
            resetSettings();
            setS(DEFAULT_SETTINGS);
            onFlash("คืนค่ากติกาเป็นค่าตั้งต้นแล้ว");
          }}
          className="btn-ghost text-rose-200"
        >
          คืนค่าตั้งต้น
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// แท็บ API
// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// แท็บ API
//
// จัดเป็นลำดับขั้น 1-2-3 อ่านไล่ลงมาได้ ไม่ต้องกระโดดไปมา
//   สรุปด้านบน → ① เลือกเจ้า → ② เลือกโมเดล → ③ บันทึก
// ส่วนคีย์กับข้อมูลเทคนิคพับเก็บไว้ เพราะตั้งครั้งเดียวแล้วแทบไม่ต้องแตะอีก
// ════════════════════════════════════════════════════════════════════════════

interface ProviderChoiceInfo {
  value: LlmProviderChoice;
  label: string;
  icon: string;
  hint: string;
}

const PROVIDER_CHOICES: ProviderChoiceInfo[] = [
  { value: "auto", label: "ตามเซิร์ฟเวอร์", icon: "⚙️", hint: "ใช้ค่าที่ตั้งไว้ใน env" },
  { value: "anthropic", label: "Claude", icon: "🟣", hint: "คำใบ้คมที่สุด" },
  { value: "openai", label: "GPT", icon: "🟢", hint: "OpenAI" },
  { value: "gemini", label: "Gemini", icon: "🔵", hint: "Google · มีโควตาฟรี" },
  { value: "openrouter", label: "OpenRouter", icon: "🟠", hint: "คีย์เดียว หลายร้อยโมเดล" },
  { value: "ollama", label: "Ollama", icon: "⚫", hint: "รันในเครื่อง ฟรี" },
];

/**
 * โมเดลแนะนำของแต่ละเจ้า — กดปุ่มเดียวเลือกได้เลยไม่ต้องรอโหลดรายชื่อ
 * เป็นเพียงคำแนะนำ ถ้าไม่แน่ใจว่าชื่อยังใช้ได้อยู่ไหมให้กด "ดูรายชื่อจริง"
 */
const SUGGESTED_MODELS: Record<string, Array<{ id: string; tag: string }>> = {
  anthropic: [
    { id: "claude-haiku-4-5-20251001", tag: "เร็ว ประหยัด" },
    { id: "claude-sonnet-5", tag: "สมดุล" },
    { id: "claude-opus-5", tag: "เก่งที่สุด" },
  ],
  openai: [
    { id: "gpt-4o-mini", tag: "เร็ว ประหยัด" },
    { id: "gpt-4o", tag: "เก่ง" },
  ],
  gemini: [
    { id: "gemini-2.0-flash", tag: "เร็ว ประหยัด" },
    { id: "gemini-2.5-flash", tag: "สมดุล" },
    { id: "gemini-2.5-pro", tag: "เก่ง" },
  ],
  openrouter: [
    { id: "openai/gpt-4o-mini", tag: "เร็ว ประหยัด" },
    { id: "anthropic/claude-sonnet-4.5", tag: "สมดุล" },
    { id: "google/gemini-2.0-flash-001", tag: "เร็ว" },
  ],
  ollama: [
    { id: "llama3.1", tag: "ทั่วไป" },
    { id: "qwen2.5", tag: "ภาษาไทยพอใช้" },
    { id: "gemma2", tag: "เบา" },
  ],
};

const KEY_PLACEHOLDER: Record<string, string> = {
  anthropic: "sk-ant-...",
  openai: "sk-...",
  gemini: "AIza... หรือ AQ....",
  openrouter: "sk-or-v1-...",
};

/** จำนวนปุ่มโมเดลที่แสดงพร้อมกันตอนโหลดรายชื่อเต็ม กัน DOM บวมตอนมี 300+ ตัว */
const MODEL_PAGE_SIZE = 40;

function ApiTab({ onFlash }: { onFlash: (m: string) => void }) {
  const [cfg, setCfg] = useState<AdminConfigResponse | null>(null);
  const [password, setPassword] = useState("");
  const [llm, setLlm] = useState<LlmSettings>(DEFAULT_LLM_SETTINGS);
  const [models, setModels] = useState<AdminModelsResponse["models"]>([]);
  const [modelQuery, setModelQuery] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [customModel, setCustomModel] = useState("");
  // คีย์ที่พิมพ์ค้างไว้ ยังไม่บันทึก — key คือชื่อ provider
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  const headers = useMemo(
    () => ({ "Content-Type": "application/json", "x-admin-password": password }),
    [password],
  );

  const refresh = async () => {
    try {
      const res = await fetch("/api/admin/config", { headers });
      setCfg((await res.json()) as AdminConfigResponse);
    } catch {
      setCfg(null);
    }
  };

  useEffect(() => {
    const saved = loadLlmSettings();
    setLlm(saved);
    setCustomModel(saved.model);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** เจ้าที่กำลังจะถูกใช้จริง — "auto" ให้ตกไปเป็นค่าของเซิร์ฟเวอร์ */
  const effectiveProvider =
    llm.provider === "auto" ? (cfg?.serverProvider ?? "anthropic") : llm.provider;
  const activeStatus = cfg?.providers.find((p) => p.provider === effectiveProvider);
  const providerLabel =
    PROVIDER_CHOICES.find((p) => p.value === effectiveProvider)?.label ?? effectiveProvider;

  // ชื่อโมเดลที่จะถูกใช้จริง — ถ้ายังไม่เลือกและใช้ค่าเซิร์ฟเวอร์อยู่ก็โชว์ของเซิร์ฟเวอร์
  const effectiveModel =
    llm.model || (llm.provider === "auto" ? (cfg?.serverModel ?? "") : "");

  const suggestions = SUGGESTED_MODELS[effectiveProvider] ?? [];
  const filteredModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q),
    );
  }, [models, modelQuery]);

  async function fetchModels() {
    setLoadingModels(true);
    setModelError(null);
    try {
      const res = await fetch(`/api/admin/models?provider=${effectiveProvider}`, { headers });
      const data = (await res.json()) as AdminModelsResponse | { error?: string };

      if (!("models" in data)) {
        setModelError(data.error ?? "ดึงรายชื่อโมเดลไม่สำเร็จ");
        return;
      }
      setModels(data.models);
      if (data.error) setModelError(data.error);
      else onFlash(`พบ ${data.models.length} โมเดล`);
    } catch (e) {
      setModelError(`ดึงรายชื่อโมเดลไม่สำเร็จ — ${String(e)}`);
    } finally {
      setLoadingModels(false);
    }
  }

  function handleProvider(value: LlmProviderChoice) {
    // โมเดลของคนละเจ้าใช้ชื่อคนละแบบ เปลี่ยนเจ้าแล้วต้องล้างโมเดลเดิมทิ้ง
    setLlm({ provider: value, model: "" });
    setCustomModel("");
    setModels([]);
    setModelQuery("");
    setModelError(null);
    setTestResult(null);
  }

  function pickModel(id: string) {
    setLlm((prev) => ({ ...prev, model: id }));
    setCustomModel(id);
    setTestResult(null);
  }

  function handleSaveChoice() {
    saveLlmSettings(llm);
    onFlash(
      llm.provider === "auto" && !llm.model
        ? "กลับไปใช้ค่าตั้งต้นของเซิร์ฟเวอร์แล้ว"
        : `บันทึกแล้ว — เกมจะใช้ ${providerLabel}${llm.model ? ` · ${llm.model}` : ""}`,
    );
  }

  function handleResetChoice() {
    resetLlmSettings();
    setLlm(DEFAULT_LLM_SETTINGS);
    setCustomModel("");
    setModels([]);
    setModelError(null);
    setTestResult(null);
    onFlash("คืนค่าเป็นตามเซิร์ฟเวอร์แล้ว");
  }

  async function handleSaveKeys() {
    const keys = Object.fromEntries(
      Object.entries(keyDrafts)
        .map(([name, value]) => [name, value.trim()])
        .filter(([, value]) => value.length > 0),
    );
    const res = await fetch("/api/admin/config", {
      method: "POST",
      headers,
      body: JSON.stringify({
        keys: Object.keys(keys).length > 0 ? keys : undefined,
        ollamaBaseUrl: ollamaUrl.trim() || undefined,
      }),
    });
    const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
    onFlash(data.message ?? data.error ?? "ไม่ทราบผล");
    // ล้างช่องคีย์ทิ้งเสมอ ไม่ให้ค้างอยู่บนหน้าจอหลังบันทึก
    setKeyDrafts({});
    await refresh();
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/config", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          provider: llm.provider === "auto" ? undefined : llm.provider,
          model: llm.model || undefined,
        }),
      });
      setTestResult((await res.json()) as { ok: boolean; message: string });
    } catch (e) {
      setTestResult({ ok: false, message: String(e) });
    } finally {
      setTesting(false);
    }
  }

  const keysDirty =
    Object.values(keyDrafts).some((v) => v.trim().length > 0) || Boolean(ollamaUrl.trim());
  const ready = activeStatus?.ready ?? false;

  return (
    <div className="space-y-4">
      {/* ══ สรุปว่าตอนนี้เกมใช้อะไร + ปุ่มทดสอบ ══════════════════════════ */}
      <section
        className={`rounded-2xl border p-4 ${
          ready
            ? "border-teal-300/50 bg-teal-400/10"
            : "border-amber-400/50 bg-amber-500/10"
        }`}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-300/80">
          ตอนนี้เกมใช้
        </p>
        <p className="mt-1 text-xl font-extrabold text-white">
          {providerLabel}
          {effectiveModel ? (
            <span className="ml-2 font-mono text-sm font-semibold text-slate-300">
              {effectiveModel}
            </span>
          ) : (
            <span className="ml-2 text-sm font-medium text-slate-400">
              (โมเดลตั้งต้นของเจ้านี้)
            </span>
          )}
        </p>
        <p className={`mt-1 text-xs ${ready ? "text-teal-100" : "text-amber-100"}`}>
          {!ready
            ? `⚠ ยังไม่มีคีย์ (${activeStatus?.envKey ?? "—"}) เกมจะเล่นได้แต่ใช้คำใบ้สำรองแทน AI`
            : activeStatus?.envKey
              ? "● ตั้งคีย์แล้ว — กดทดสอบเพื่อยืนยันว่าเรียกได้จริง"
              : "● ไม่ต้องใช้คีย์ — กดทดสอบเพื่อดูว่าต่อถึงหรือเปล่า"}
        </p>

        <button
          onClick={() => void handleTest()}
          disabled={testing}
          className="btn-teal mt-3 w-full text-sm"
        >
          {testing ? "กำลังทดสอบ..." : "🔌 ทดสอบเชื่อมต่อจริง"}
        </button>

        {testResult ? (
          <p
            className={`mt-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
              testResult.ok
                ? "border-teal-300/50 bg-teal-400/15 text-teal-50"
                : "border-rose-400/50 bg-rose-500/15 text-rose-50"
            }`}
          >
            {testResult.ok ? "✅ " : "❌ "}
            {testResult.message}
          </p>
        ) : null}
      </section>

      {/* ══ ① เลือกผู้ให้บริการ ═══════════════════════════════════════════ */}
      <section className="panel space-y-3 p-4">
        <StepTitle n="1" title="เลือกผู้ให้บริการ" />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PROVIDER_CHOICES.map((p) => {
            const active = llm.provider === p.value;
            const status = cfg?.providers.find((s) => s.provider === p.value);
            return (
              <button
                key={p.value}
                onClick={() => handleProvider(p.value)}
                className={`relative rounded-xl border p-3 text-left transition ${
                  active
                    ? "border-sky-400 bg-sky-500/20 shadow-glow"
                    : "border-stage-edge bg-white/[0.03] hover:bg-white/[0.07]"
                }`}
              >
                {active ? (
                  <span className="absolute right-2 top-2 text-xs text-sky-300">✓</span>
                ) : null}
                <span className="text-base" aria-hidden="true">
                  {p.icon}
                </span>
                <p className="mt-0.5 text-xs font-bold text-white">{p.label}</p>
                <p className="mt-0.5 text-[10px] leading-snug text-slate-400">{p.hint}</p>
                {status ? (
                  <p
                    className={`mt-1 text-[10px] font-semibold ${
                      status.ready ? "text-teal-300" : "text-amber-300"
                    }`}
                  >
                    {/* Ollama ไม่ต้องใช้คีย์ ถ้าเขียนว่า "มีคีย์แล้ว" จะเข้าใจผิด */}
                    {!status.envKey
                      ? "● ไม่ต้องใช้คีย์"
                      : status.ready
                        ? "● มีคีย์แล้ว"
                        : "○ ยังไม่มีคีย์"}
                  </p>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      {/* ══ ② เลือกโมเดล — เป็นปุ่มกดทั้งหมด ═════════════════════════════ */}
      <section className="panel space-y-3 p-4">
        <StepTitle n="2" title="เลือกโมเดล" />

        {suggestions.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-slate-300">แนะนำ — กดเลือกได้เลย</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {suggestions.map((s) => {
                const active = llm.model === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => pickModel(s.id)}
                    className={`rounded-xl border px-3 py-2.5 text-left transition ${
                      active
                        ? "border-sky-400 bg-sky-500/20 shadow-glow"
                        : "border-stage-edge bg-white/[0.03] hover:bg-white/[0.07]"
                    }`}
                  >
                    <p className="truncate font-mono text-[11px] font-bold text-white">
                      {s.id}
                    </p>
                    <p className="mt-0.5 text-[10px] text-slate-400">{s.tag}</p>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void fetchModels()}
            disabled={loadingModels}
            className="btn-ghost text-xs"
          >
            {loadingModels ? "กำลังโหลด..." : "📋 ดูรายชื่อจริงทั้งหมด"}
          </button>
          {llm.model ? (
            <button
              onClick={() => {
                setLlm((prev) => ({ ...prev, model: "" }));
                setCustomModel("");
              }}
              className="text-[11px] text-slate-400 underline hover:text-slate-200"
            >
              ล้างที่เลือกไว้
            </button>
          ) : null}
        </div>

        {modelError ? (
          <p className="rounded-lg border border-rose-400/50 bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-100">
            ❌ {modelError}
          </p>
        ) : null}

        {models.length > 0 ? (
          <div className="space-y-2">
            <input
              value={modelQuery}
              onChange={(e) => setModelQuery(e.target.value)}
              placeholder={`ค้นหาใน ${models.length} โมเดล...`}
              className="field py-2 text-sm"
            />
            <div className="grid max-h-72 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
              {filteredModels.slice(0, MODEL_PAGE_SIZE).map((m) => {
                const active = llm.model === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => pickModel(m.id)}
                    title={m.id}
                    className={`rounded-lg border px-3 py-2 text-left transition ${
                      active
                        ? "border-sky-400 bg-sky-500/20"
                        : "border-stage-edge bg-white/[0.03] hover:bg-white/[0.07]"
                    }`}
                  >
                    <p className="truncate text-[11px] font-semibold text-slate-100">
                      {m.label}
                    </p>
                    <p className="truncate font-mono text-[10px] text-slate-500">{m.id}</p>
                  </button>
                );
              })}
            </div>
            {filteredModels.length > MODEL_PAGE_SIZE ? (
              <p className="text-[10px] text-slate-500">
                แสดง {MODEL_PAGE_SIZE} จาก {filteredModels.length} รายการ — พิมพ์ค้นหาเพื่อกรองให้แคบลง
              </p>
            ) : null}
            {filteredModels.length === 0 ? (
              <p className="text-[11px] text-slate-400">ไม่มีโมเดลที่ตรงกับคำค้น</p>
            ) : null}
          </div>
        ) : null}

        <details className="group">
          <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-200">
            หรือพิมพ์ชื่อโมเดลเอง
          </summary>
          <div className="mt-2 flex gap-2">
            <input
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder={suggestions[0]?.id ?? "ชื่อโมเดล"}
              spellCheck={false}
              className="field flex-1 py-2 text-sm"
            />
            <button
              onClick={() => pickModel(customModel.trim())}
              disabled={!customModel.trim()}
              className="btn-ghost shrink-0 text-xs"
            >
              ใช้ชื่อนี้
            </button>
          </div>
        </details>
      </section>

      {/* ══ ③ บันทึก ═════════════════════════════════════════════════════ */}
      <section className="panel space-y-2 p-4">
        <StepTitle n="3" title="บันทึกการเลือก" />
        <p className="text-[11px] leading-relaxed text-slate-400">
          เก็บไว้ในเบราว์เซอร์เครื่องนี้ จึงเปลี่ยนได้ทันทีแม้เป็นเว็บจริง ไม่ต้อง redeploy
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={handleSaveChoice} className="btn-primary text-sm">
            บันทึก
          </button>
          <button onClick={handleResetChoice} className="btn-ghost text-sm">
            คืนค่าเริ่มต้น
          </button>
        </div>
      </section>

      {/* ══ คีย์ API — พับไว้ ════════════════════════════════════════════ */}
      <details className="panel p-4">
        <summary className="cursor-pointer text-sm font-bold text-white">
          🔑 คีย์ API
          <span className="ml-2 text-[11px] font-normal text-slate-400">
            ({cfg?.providers.filter((p) => p.ready && p.envKey).length ?? 0} เจ้าพร้อมใช้)
          </span>
        </summary>

        <div className="mt-3 space-y-3">
          {cfg?.passwordRequired ? (
            <Field label="รหัสผ่านหลังบ้าน (ADMIN_PASSWORD)">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => void refresh()}
                className="field py-2 text-sm"
              />
            </Field>
          ) : null}

          {!cfg?.writable ? (
            <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
              เว็บจริงแก้คีย์ที่นี่ไม่ได้ (ระบบไฟล์เป็น read-only) — ตั้งที่{" "}
              <b>Vercel → Settings → Environment Variables</b> แล้ว Redeploy
              <br />
              ⚠️ ตอนสร้างตัวแปรอย่าลืมติ๊กช่อง <b>Production</b> ไม่งั้นเว็บจริงจะมองไม่เห็น
            </p>
          ) : null}

          {(cfg?.providers ?? [])
            .filter((p) => p.envKey)
            .map((p) => (
              <Field key={p.provider} label={`${p.label} — ${p.envKey}`}>
                <input
                  type="password"
                  value={keyDrafts[p.provider] ?? ""}
                  onChange={(e) =>
                    setKeyDrafts({ ...keyDrafts, [p.provider]: e.target.value })
                  }
                  placeholder={
                    p.ready ? `ตั้งไว้แล้ว · ${p.maskedKey}` : KEY_PLACEHOLDER[p.provider]
                  }
                  autoComplete="off"
                  disabled={!cfg?.writable}
                  className="field py-2 text-sm disabled:opacity-50"
                />
              </Field>
            ))}

          <Field label="Ollama — OLLAMA_BASE_URL">
            <input
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
              placeholder={cfg?.ollamaBaseUrl ?? "http://127.0.0.1:11434"}
              autoComplete="off"
              spellCheck={false}
              disabled={!cfg?.writable}
              className="field py-2 text-sm disabled:opacity-50"
            />
          </Field>

          {cfg?.writable ? (
            <>
              <button
                onClick={() => void handleSaveKeys()}
                disabled={!keysDirty}
                className="btn-primary w-full text-sm"
              >
                บันทึกลง .env.local
              </button>
              <p className="text-[11px] leading-relaxed text-slate-400">
                บันทึกแล้วต้อง <b className="text-slate-200">รีสตาร์ท dev server</b>{" "}
                (Ctrl+C แล้ว npm run dev) เพราะ Next.js อ่าน .env.local ตอนบูตเท่านั้น
              </p>
            </>
          ) : null}
        </div>
      </details>

      {/* ══ ข้อมูลเทคนิค — พับไว้ ════════════════════════════════════════ */}
      <details className="panel p-4">
        <summary className="cursor-pointer text-sm font-bold text-white">
          🔧 ข้อมูลเทคนิค
          {cfg?.misspelledEnv.length ? (
            <span className="ml-2 text-[11px] font-normal text-amber-300">
              (มี {cfg.misspelledEnv.length} เรื่องต้องดู)
            </span>
          ) : null}
        </summary>

        <div className="mt-3 space-y-2">
          {cfg ? (
            <dl className="space-y-1.5 text-xs">
              <Row label="ค่าตั้งต้นเซิร์ฟเวอร์">
                <span className="text-slate-300">
                  {cfg.serverProvider} · {cfg.serverModel}
                </span>
              </Row>
              <Row label="สภาพแวดล้อม">
                <span className="text-slate-300">
                  {cfg.environment}
                  {cfg.deployment.vercelEnv ? ` · Vercel: ${cfg.deployment.vercelEnv}` : ""}
                </span>
              </Row>
              {cfg.deployment.commitSha ? (
                <Row label="โค้ดที่รันอยู่">
                  <span className="font-mono text-slate-300">
                    {cfg.deployment.branch}@{cfg.deployment.commitSha}
                  </span>
                </Row>
              ) : null}
              <Row label="REVEAL_SECRET">
                <span className="text-slate-300">
                  {cfg.hasRevealSecret ? "ตั้งค่าแล้ว" : "ไม่ได้ตั้ง (derive จาก API key)"}
                </span>
              </Row>
            </dl>
          ) : (
            <p className="text-xs text-slate-400">กำลังโหลด...</p>
          )}

          {cfg?.wrongCaseEnv.length ? (
            <p className="rounded-lg border border-sky-400/40 bg-sky-500/10 px-3 py-2 text-xs leading-relaxed text-sky-100">
              ℹ️ ตัวแปร{" "}
              <b className="font-mono">
                {cfg.wrongCaseEnv.map((e) => e.found).join(", ")}
              </b>{" "}
              ตั้งชื่อต่างจากมาตรฐานแค่ตัวพิมพ์ — <b>ระบบอ่านให้แล้ว ใช้งานได้ปกติ</b>
            </p>
          ) : null}

          {cfg?.misspelledEnv.length ? (
            <div className="space-y-1.5 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
              <p>
                ⚠️ ชื่อตัวแปรพวกนี้สะกดไม่ตรง ระบบอ่านไม่ได้:{" "}
                <b className="font-mono">{cfg.misspelledEnv.join(", ")}</b>
              </p>
              {cfg.environment === "production" ? (
                <p className="text-amber-200/90">
                  บน Vercel การกด Edit แก้ได้แค่ <b>ค่า</b> ไม่ได้แก้ <b>ชื่อ</b> —
                  ต้องลบตัวเก่าทิ้งแล้วสร้างใหม่ จากนั้น Redeploy
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function StepTitle({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/25 text-[11px] font-bold text-sky-200">
        {n}
      </span>
      <h2 className="text-sm font-bold text-white">{title}</h2>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ชิ้นส่วนเล็ก ๆ
// ════════════════════════════════════════════════════════════════════════════

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-slate-300">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-white/5 pb-1.5 last:border-0">
      <dt className="shrink-0 text-slate-400">{label}</dt>
      <dd className="truncate text-right">{children}</dd>
    </div>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  labels?: Record<string, string>;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="field text-sm">
        {options.map((o) => (
          <option key={o} value={o}>
            {labels?.[o] ?? o}
          </option>
        ))}
      </select>
    </Field>
  );
}
