"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { QUESTION_BANK } from "@/lib/questions";
import { clearSeen, recentTopics, seenCount } from "@/lib/history";
import { resetPrefetch } from "@/lib/questionPrefetch";
import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_SETTINGS,
  FEED_GROUP_CHOICES,
  FEED_GROUP_TH,
  KEYED_PROVIDERS,
  clearApiKey,
  llmRequestPayload,
  isUsingCustomQuestions,
  isValidApiKey,
  loadApiKeys,
  loadLlmSettings,
  loadQuestions,
  loadSettings,
  resetLlmSettings,
  resetQuestions,
  resetSettings,
  sanitizeQuestion,
  saveApiKey,
  saveLlmSettings,
  saveQuestions,
  saveSettings,
  type ApiKeyMap,
  type GameSettings,
  type KeyedProvider,
  type LlmProviderChoice,
  type LlmSettings,
  type QuestionSource,
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

interface TrialResult {
  ok: boolean;
  message: string;
  questions: Question[];
}

function RulesTab({ onFlash }: { onFlash: (m: string) => void }) {
  const [s, setS] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [seenTotal, setSeenTotal] = useState(0);
  const [trying, setTrying] = useState(false);
  const [trial, setTrial] = useState<TrialResult | null>(null);

  useEffect(() => {
    setS(loadSettings());
    setSeenTotal(seenCount());
  }, []);

  /**
   * ลองสร้างจริง 3 ข้อด้วยค่าที่กำลังตั้งอยู่บนหน้าจอ (ยังไม่ต้องกดบันทึก)
   * ไว้เช็กว่าคีย์ใช้ได้ ฟีดดึงได้ และคำถามที่ออกมาหน้าตาโอเคไหม ก่อนเอาไปเล่นจริง
   */
  async function handleTrySource() {
    setTrying(true);
    setTrial(null);
    try {
      const res = await fetch("/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stages: [{ stage: "warmup", count: 3, pointValue: s.points.warmup }],
          groups: s.feedGroups,
          avoid: recentTopics(20),
          llm: llmRequestPayload(),
        }),
      });
      const data = (await res.json()) as {
        questions?: Question[];
        source?: string;
        sourcesUsed?: string[];
      };
      const questions = data.questions ?? [];
      setTrial({
        ok: questions.length > 0,
        message:
          questions.length > 0
            ? `สร้างได้ ${questions.length} ข้อ จากข่าว ${data.sourcesUsed?.length ?? 0} สำนัก`
            : "สร้างไม่สำเร็จ — เช็กว่าตั้งคีย์และโมเดลในแท็บ API ถูกต้องแล้ว " +
              "(ดูสาเหตุจริงได้ใน log ของเซิร์ฟเวอร์) ตอนนี้เกมจะใช้คลังในเครื่องแทน",
        questions,
      });
    } catch (e) {
      setTrial({ ok: false, message: `เรียกไม่สำเร็จ — ${String(e)}`, questions: [] });
    } finally {
      setTrying(false);
    }
  }

  const total = s.counts.warmup + s.counts.push + s.counts.final;
  const totalSeconds = STAGES.reduce((sum, st) => sum + s.counts[st] * s.seconds[st], 0);

  return (
    <div className="space-y-4">
      {/* ══ แหล่งที่มาของคำถาม ═══════════════════════════════════════════ */}
      <section className="panel space-y-3 p-4">
        <h2 className="text-sm font-bold text-white">คำถามมาจากไหน</h2>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {(
            [
              [
                "live",
                "แต่งสดจากข่าวจริง",
                "ดึงข่าวและบทความที่เพิ่งเผยแพร่จากสำนักข่าวทั่วโลก แล้วให้ AI แต่งคำถามใหม่ทุกเกม ไม่ซ้ำของเดิม",
              ],
              [
                "bank",
                "ใช้คลังในเครื่อง",
                "หยิบจากคลังคำถามในแท็บ “คำถาม” อย่างเดียว ไม่เรียก AI ไม่เสียโทเคน เริ่มเกมได้ทันที",
              ],
            ] as Array<[QuestionSource, string, string]>
          ).map(([value, label, detail]) => (
            <button
              key={value}
              onClick={() => setS({ ...s, questionSource: value })}
              className={`rounded-xl border p-3.5 text-left transition ${
                s.questionSource === value
                  ? "border-sky-400 bg-sky-500/20 shadow-glow"
                  : "border-stage-edge bg-white/[0.03] hover:bg-white/[0.07]"
              }`}
            >
              <p className="text-sm font-bold text-white">{label}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{detail}</p>
            </button>
          ))}
        </div>

        {s.questionSource === "live" ? (
          <>
            <div>
              <p className="mb-1.5 text-[11px] font-semibold text-slate-300">
                หมวดข่าวที่อนุญาตให้เอามาตั้งคำถาม
              </p>
              <div className="flex flex-wrap gap-1.5">
                {FEED_GROUP_CHOICES.map((g) => {
                  const on = s.feedGroups.includes(g);
                  return (
                    <button
                      key={g}
                      onClick={() =>
                        setS({
                          ...s,
                          feedGroups: on
                            ? s.feedGroups.filter((x) => x !== g)
                            : [...s.feedGroups, g],
                        })
                      }
                      className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${
                        on
                          ? "border-teal-300/70 bg-teal-400/20 text-teal-100"
                          : "border-stage-edge bg-white/[0.03] text-slate-400 hover:bg-white/[0.08]"
                      }`}
                    >
                      {FEED_GROUP_TH[g] ?? g}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                ปิดหมดทุกหมวด = ใช้ทุกหมวด · ตั้งใจไม่มีหมวด “ข่าวด่วนทั่วไป”
                เพราะเกมนี้แปะคำใบ้หลอกลงบนข้อมูล จึงไม่ควรเอาไปแตะข่าวสงคราม
                คดีความ หรือภัยพิบัติที่มีคนเดือดร้อนจริง
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
              <button
                onClick={() => void handleTrySource()}
                disabled={trying}
                className="btn-ghost px-4 py-2 text-xs"
              >
                {trying ? "กำลังลอง..." : "ลองสร้างดู 3 ข้อ"}
              </button>
              <span className="text-[11px] text-slate-500">
                จำคำถามที่เคยเล่นไว้ {seenTotal} ข้อ
              </span>
              <button
                onClick={() => {
                  clearSeen();
                  setSeenTotal(0);
                  resetPrefetch();
                  onFlash("ล้างความจำกันซ้ำแล้ว — คำถามเก่าจะกลับมาโผล่ได้อีก");
                }}
                className="text-[11px] text-slate-500 underline hover:text-slate-300"
              >
                ล้างความจำ
              </button>
            </div>

            {trial ? (
              <div
                className={`space-y-2 rounded-xl border px-3 py-2.5 text-[11px] leading-relaxed ${
                  trial.ok
                    ? "border-teal-300/50 bg-teal-400/10 text-teal-50"
                    : "border-rose-400/50 bg-rose-500/10 text-rose-50"
                }`}
              >
                <p className="font-semibold">{trial.message}</p>
                {trial.questions.map((q) => (
                  <p key={q.id} className="text-slate-200">
                    <span className="text-sky-300">[{q.format}]</span> {q.prompt}
                  </p>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </section>

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
            // ชุดคำถามที่เตรียมไว้ล่วงหน้าอิงกติกาชุดเก่า ต้องทิ้งแล้วเตรียมใหม่
            resetPrefetch();
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
            resetPrefetch();
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
  /** คำอธิบายหนึ่งบรรทัดบนการ์ดเลือกค่าย */
  blurb: string;
  /** หน้าขอคีย์ของค่ายนั้น — Ollama กับ auto ไม่ต้องใช้คีย์ */
  keyUrl?: string;
  keyPlaceholder?: string;
}

const PROVIDER_CHOICES: ProviderChoiceInfo[] = [
  {
    value: "anthropic",
    label: "Claude",
    blurb: "คุณภาพงานเขียนภาษาไทยดีที่สุด และ prompt คำใบ้ทั้งหมดจูนมากับค่ายนี้",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyPlaceholder: "sk-ant-...",
  },
  {
    value: "gemini",
    label: "Gemini",
    blurb: "ของ Google มีโควตาฟรีให้ใช้ เหมาะกับงานประจำวัน",
    keyUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza... หรือ AQ....",
  },
  {
    value: "openai",
    label: "GPT",
    blurb: "ของ OpenAI ใช้ได้ครอบจักรวาล คีย์จาก platform.openai.com",
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-...",
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    blurb: "คีย์เดียวใช้ได้หลายร้อยโมเดล ทั้ง GPT, Claude, Llama, Qwen",
    keyUrl: "https://openrouter.ai/keys",
    keyPlaceholder: "sk-or-v1-...",
  },
  {
    value: "ollama",
    label: "Ollama",
    blurb: "รันโมเดลบนเครื่องตัวเอง ไม่เสียค่าใช้จ่ายและข้อมูลไม่ออกนอกเครื่อง",
  },
  {
    value: "auto",
    label: "ตามเซิร์ฟเวอร์",
    blurb: "ใช้ค่าที่ตั้งไว้ใน environment ของเซิร์ฟเวอร์ ไม่ต้องเลือกเอง",
  },
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
    // gemini-2.0-flash ถูก Google ปลดระวางแล้ว (404) อย่าใส่กลับมา
    { id: "gemini-flash-latest", tag: "เร็ว ตามรุ่นใหม่เสมอ" },
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
  // คีย์ที่บันทึกไว้ใน localStorage ของเบราว์เซอร์เครื่องนี้
  const [browserKeys, setBrowserKeys] = useState<ApiKeyMap>({});
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
    setBrowserKeys(loadApiKeys());
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** เจ้าที่กำลังจะถูกใช้จริง — "auto" ให้ตกไปเป็นค่าของเซิร์ฟเวอร์ */
  const effectiveProvider =
    llm.provider === "auto" ? (cfg?.serverProvider ?? "anthropic") : llm.provider;
  const activeStatus = cfg?.providers.find((p) => p.provider === effectiveProvider);

  const keyedProvider = (value: string): KeyedProvider | null =>
    (KEYED_PROVIDERS as string[]).includes(value) ? (value as KeyedProvider) : null;

  /**
   * คีย์ที่จะถูกใช้จริงในฝั่งเบราว์เซอร์
   *
   * แนบไปกับ request ได้เฉพาะตอนที่ล็อกค่ายไว้แล้ว — ถ้ายังเป็น "auto"
   * ฝั่งนี้ไม่รู้ว่าเซิร์ฟเวอร์ตั้งค่ายอะไร จึงไม่รู้ว่าควรส่งคีย์ของใคร
   */
  const activeKeyed = llm.provider === "auto" ? null : keyedProvider(effectiveProvider);
  const browserKey = activeKeyed ? browserKeys[activeKeyed] : undefined;
  /** มีคีย์เก็บไว้ในเบราว์เซอร์แต่โหมด auto ไม่ใช้ — ต้องบอก ไม่งั้นคนจะงงว่าคีย์หายไปไหน */
  const stashedKeyProvider =
    llm.provider === "auto" ? KEYED_PROVIDERS.find((p) => browserKeys[p]) : undefined;
  /** ข้อมูลของค่ายที่กำลังจะถูกใช้จริง — ใช้วาดแผงตั้งค่าด้านล่าง */
  const activeInfo =
    PROVIDER_CHOICES.find((p) => p.value === effectiveProvider) ?? PROVIDER_CHOICES[0];
  const providerLabel = activeInfo.label;

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
      // POST ไม่ใช่ GET เพราะคีย์ต้องไปใน body ไม่ใช่ query string
      const res = await fetch("/api/admin/models", {
        method: "POST",
        headers,
        body: JSON.stringify({ provider: effectiveProvider, apiKey: browserKey }),
      });
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

  /**
   * บันทึกคีย์ที่กรอก
   *
   * เก็บลง localStorage เสมอ เพราะเป็นทางเดียวที่ใช้ได้ทั้งบนเครื่องและบนเว็บจริง
   * (บน Vercel ระบบไฟล์เป็น read-only จะเขียน .env.local ไม่ได้)
   * ตอนรัน dev ในเครื่องจะเขียนลง .env.local ให้ด้วย จะได้ไม่หายตอนล้างเบราว์เซอร์
   */
  async function handleSaveKeys() {
    const draft = (keyDrafts[effectiveProvider] ?? "").trim();
    const target = keyedProvider(effectiveProvider);

    if (draft && target) {
      if (!isValidApiKey(draft)) {
        onFlash("คีย์ไม่ถูกรูปแบบ — ต้องยาว 16 ตัวขึ้นไป และห้ามมีช่องว่างหรือขึ้นบรรทัดใหม่");
        return;
      }
      saveApiKey(target, draft);
      setBrowserKeys(loadApiKeys());
      // เก็บคีย์ของค่ายไหนไว้ก็ล็อกค่ายนั้นให้เลย ไม่งั้นคีย์จะไม่ถูกแนบไปกับ request
      const next: LlmSettings = { ...llm, provider: target };
      setLlm(next);
      saveLlmSettings(next);
    }

    const messages: string[] = [];
    if (draft && target) messages.push(`เก็บคีย์ ${providerLabel} ไว้ในเบราว์เซอร์นี้แล้ว ใช้ได้ทันที`);

    // dev เท่านั้น — เขียนลง .env.local ให้ด้วยเพื่อให้ค่าอยู่ยาว
    if (cfg?.writable && (draft || ollamaUrl.trim())) {
      try {
        const res = await fetch("/api/admin/config", {
          method: "POST",
          headers,
          body: JSON.stringify({
            keys: draft && target ? { [target]: draft } : undefined,
            ollamaBaseUrl: ollamaUrl.trim() || undefined,
          }),
        });
        const data = (await res.json()) as { message?: string; error?: string };
        if (data.error) messages.push(`(.env.local: ${data.error})`);
        else messages.push("เขียนลง .env.local ให้แล้ว (มีผลถาวรหลังรีสตาร์ท dev server)");
      } catch (e) {
        messages.push(`(เขียน .env.local ไม่สำเร็จ: ${String(e)})`);
      }
    }

    onFlash(messages.join(" · ") || "ยังไม่ได้กรอกอะไรให้บันทึก");
    // ล้างช่องคีย์ทิ้งเสมอ ไม่ให้ค้างอยู่บนหน้าจอหลังบันทึก
    setKeyDrafts({});
    setTestResult(null);
    await refresh();
  }

  function handleClearBrowserKey() {
    if (!activeKeyed) return;
    clearApiKey(activeKeyed);
    setBrowserKeys(loadApiKeys());
    setTestResult(null);
    onFlash(`ลบคีย์ ${providerLabel} ออกจากเบราว์เซอร์นี้แล้ว`);
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
          apiKey: browserKey,
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
    Boolean((keyDrafts[effectiveProvider] ?? "").trim()) || Boolean(ollamaUrl.trim());
  const ready = Boolean(browserKey) || (activeStatus?.ready ?? false);

  return (
    <div className="space-y-4">
      {/* ══ หัวเรื่อง ═════════════════════════════════════════════════════ */}
      <header>
        <h2 className="text-xl font-extrabold text-white">ตั้งค่าโมเดล</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          เลือกค่ายที่จะใช้สร้างคำใบ้และตรวจคำตอบ ตั้งครั้งเดียวจำไว้ให้เลย
        </p>
      </header>

      {/* ══ เลือกค่าย ═════════════════════════════════════════════════════ */}
      <section className="panel p-4 sm:p-5">
        <h3 className="mb-3 text-sm font-bold text-white">เลือกค่าย</h3>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {PROVIDER_CHOICES.map((p) => {
            const active = llm.provider === p.value;
            const status = cfg?.providers.find((s) => s.provider === p.value);
            const keyed = keyedProvider(p.value);
            // auto ไม่มีคีย์ของตัวเอง ส่วน Ollama ไม่ต้องใช้คีย์จึงถือว่าพร้อมเสมอ
            // ค่ายที่ใช้คีย์ นับทั้งคีย์ในเบราว์เซอร์และคีย์ที่ตั้งไว้บนเซิร์ฟเวอร์
            const configured =
              p.value === "auto"
                ? false
                : Boolean(keyed && browserKeys[keyed]) ||
                  (status ? !status.envKey || status.ready : false);
            return (
              <button
                key={p.value}
                onClick={() => handleProvider(p.value)}
                className={`rounded-xl border p-3.5 text-left transition ${
                  active
                    ? "border-sky-400 bg-sky-500/20 shadow-glow"
                    : "border-stage-edge bg-white/[0.03] hover:bg-white/[0.07]"
                }`}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-bold text-white">{p.label}</span>
                  {configured ? (
                    <span className="chip bg-teal-400/20 px-2 py-0.5 text-[10px] text-teal-100">
                      ตั้งค่าแล้ว
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{p.blurb}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* ══ ตั้งค่าค่ายที่เลือก ════════════════════════════════════════════ */}
      <section className="panel space-y-4 p-4 sm:p-5">
        <h3 className="text-sm font-bold text-white">ตั้งค่า {providerLabel}</h3>

        {cfg?.passwordRequired ? (
          <Field label="รหัสผ่านหลังบ้าน (ADMIN_PASSWORD)">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => void refresh()}
              className="field py-2.5 text-sm"
            />
          </Field>
        ) : null}

        {llm.provider === "auto" ? (
          <p className="rounded-xl border border-sky-400/40 bg-sky-500/10 px-3 py-2.5 text-[11px] leading-relaxed text-sky-100">
            กำลังใช้ค่าของเซิร์ฟเวอร์ — ตอนนี้คือ <b>{cfg?.serverProvider ?? "—"}</b>
            {cfg?.serverModel ? (
              <>
                {" · "}
                <b className="font-mono">{cfg.serverModel}</b>
              </>
            ) : null}{" "}
            ถ้าอยากล็อกค่ายเอง ให้กดเลือกการ์ดด้านบน
            {stashedKeyProvider ? (
              <>
                <br />
                <span className="text-amber-200">
                  หมายเหตุ — มีคีย์ที่เก็บไว้ในเบราว์เซอร์นี้อยู่ แต่โหมด
                  &quot;ตามเซิร์ฟเวอร์&quot; จะไม่ใช้คีย์นั้น ต้องกดเลือกการ์ดของค่ายนั้นก่อน
                </span>
              </>
            ) : null}
          </p>
        ) : null}

        {/* API key ของค่ายที่กำลังใช้ */}
        {activeInfo.keyUrl ? (
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-300">
              API key
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={keyDrafts[effectiveProvider] ?? ""}
                onChange={(e) =>
                  setKeyDrafts({ ...keyDrafts, [effectiveProvider]: e.target.value })
                }
                placeholder={
                  browserKey
                    ? "เก็บคีย์ไว้ในเบราว์เซอร์นี้แล้ว — พิมพ์ใหม่เพื่อเปลี่ยน"
                    : activeStatus?.ready
                      ? `เซิร์ฟเวอร์ตั้งไว้แล้ว · ${activeStatus.maskedKey} — พิมพ์ใหม่เพื่อใช้คีย์ของคุณแทน`
                      : activeInfo.keyPlaceholder
                }
                autoComplete="off"
                spellCheck={false}
                className="field flex-1 py-2.5 text-sm"
              />
              <button
                onClick={() => void handleSaveKeys()}
                disabled={!keysDirty}
                className="btn-primary shrink-0 px-5 py-2.5 text-sm disabled:opacity-40"
              >
                บันทึก
              </button>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
              {browserKey ? (
                <span className="text-teal-300">ใช้คีย์ในเบราว์เซอร์นี้</span>
              ) : activeStatus?.ready ? (
                <span className="text-teal-300">ใช้คีย์ของเซิร์ฟเวอร์</span>
              ) : (
                <span className="text-amber-300">ยังไม่มีคีย์</span>
              )}{" "}
              <a
                href={activeInfo.keyUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sky-300 underline hover:text-sky-200"
              >
                ขอได้ที่นี่
              </a>{" "}
              — คีย์ที่กรอกตรงนี้เก็บใน localStorage ของเบราว์เซอร์เครื่องนี้
              และถูกแนบไปกับทุกครั้งที่เกมเรียก AI
              {cfg?.writable
                ? ` ตอนรันในเครื่องจะเขียนลง .env.local (${activeStatus?.envKey ?? "—"}) ให้ด้วย`
                : ` ถ้าอยากให้ทุกคนใช้ร่วมกัน ให้ตั้ง ${activeStatus?.envKey ?? "—"} ที่ Vercel แล้ว Redeploy แทน`}
              {browserKey ? (
                <>
                  {" · "}
                  <button
                    onClick={handleClearBrowserKey}
                    className="text-rose-300 underline hover:text-rose-200"
                  >
                    ลบคีย์ออกจากเบราว์เซอร์
                  </button>
                </>
              ) : null}
            </p>
          </div>
        ) : null}

        {/* Ollama ใช้ URL แทนคีย์ */}
        {effectiveProvider === "ollama" ? (
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-300">
              ที่อยู่เซิร์ฟเวอร์ Ollama
            </label>
            <div className="flex gap-2">
              <input
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
                placeholder={cfg?.ollamaBaseUrl ?? "http://127.0.0.1:11434"}
                autoComplete="off"
                spellCheck={false}
                disabled={!cfg?.writable}
                className="field flex-1 py-2.5 font-mono text-sm disabled:opacity-50"
              />
              <button
                onClick={() => void handleSaveKeys()}
                disabled={!cfg?.writable || !keysDirty}
                className="btn-primary shrink-0 px-5 py-2.5 text-sm"
              >
                บันทึก
              </button>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
              ไม่ต้องใช้คีย์ — แต่เซิร์ฟเวอร์ต้องต่อถึงเครื่องที่รัน Ollama ได้
              บนเว็บจริงจะเรียก localhost ของคุณไม่ได้
            </p>
          </div>
        ) : null}

        {/* โมเดล */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-300">โมเดล</label>
          <input
            value={customModel}
            onChange={(e) => {
              setCustomModel(e.target.value);
              setLlm((prev) => ({ ...prev, model: e.target.value.trim() }));
              setTestResult(null);
            }}
            placeholder={suggestions[0]?.id ?? "ชื่อโมเดล"}
            autoComplete="off"
            spellCheck={false}
            className="field py-2.5 font-mono text-sm"
          />

          {suggestions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => pickModel(s.id)}
                  title={s.tag}
                  className={`rounded-lg border px-2.5 py-1 font-mono text-[10px] transition ${
                    llm.model === s.id
                      ? "border-sky-400 bg-sky-500/20 text-white"
                      : "border-stage-edge bg-white/[0.03] text-slate-300 hover:bg-white/[0.08]"
                  }`}
                >
                  {s.id}
                </button>
              ))}
              <button
                onClick={() => void fetchModels()}
                disabled={loadingModels}
                className="rounded-lg border border-stage-edge bg-white/[0.03] px-2.5 py-1 text-[10px] text-slate-300 transition hover:bg-white/[0.08] disabled:opacity-50"
              >
                {loadingModels ? "กำลังโหลด..." : "ดูรายชื่อจริงทั้งหมด"}
              </button>
            </div>
          ) : null}

          {modelError ? (
            <p className="mt-2 rounded-lg border border-rose-400/50 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-100">
              {modelError}
            </p>
          ) : null}

          {models.length > 0 ? (
            <div className="mt-2 space-y-2">
              <input
                value={modelQuery}
                onChange={(e) => setModelQuery(e.target.value)}
                placeholder={`ค้นหาใน ${models.length} โมเดล...`}
                className="field py-2 text-sm"
              />
              <div className="grid max-h-64 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                {filteredModels.slice(0, MODEL_PAGE_SIZE).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => pickModel(m.id)}
                    title={m.id}
                    className={`rounded-lg border px-3 py-2 text-left transition ${
                      llm.model === m.id
                        ? "border-sky-400 bg-sky-500/20"
                        : "border-stage-edge bg-white/[0.03] hover:bg-white/[0.07]"
                    }`}
                  >
                    <p className="truncate text-[11px] font-semibold text-slate-100">
                      {m.label}
                    </p>
                    <p className="truncate font-mono text-[10px] text-slate-500">{m.id}</p>
                  </button>
                ))}
              </div>
              {filteredModels.length > MODEL_PAGE_SIZE ? (
                <p className="text-[10px] text-slate-500">
                  แสดง {MODEL_PAGE_SIZE} จาก {filteredModels.length} รายการ —
                  พิมพ์ค้นหาเพื่อกรองให้แคบลง
                </p>
              ) : null}
              {filteredModels.length === 0 ? (
                <p className="text-[11px] text-slate-400">ไม่มีโมเดลที่ตรงกับคำค้น</p>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* แถบล่าง: สถานะซ้าย ปุ่มขวา */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
          <div className="min-w-0">
            <p
              className={`text-xs font-semibold ${ready ? "text-teal-300" : "text-amber-300"}`}
            >
              {ready ? "พร้อมใช้งาน" : "ยังไม่มีคีย์ — เกมจะใช้คำใบ้สำรองแทน AI"}
            </p>
            <button
              onClick={handleResetChoice}
              className="mt-0.5 text-[11px] text-slate-500 underline hover:text-slate-300"
            >
              คืนค่าเริ่มต้น
            </button>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => void handleTest()}
              disabled={testing}
              className="btn-ghost px-4 py-2.5 text-sm"
            >
              {testing ? "กำลังทดสอบ..." : "ทดสอบการเชื่อมต่อ"}
            </button>
            <button onClick={handleSaveChoice} className="btn-primary px-5 py-2.5 text-sm">
              เริ่มใช้งาน
            </button>
          </div>
        </div>

        {testResult ? (
          <p
            className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${
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
