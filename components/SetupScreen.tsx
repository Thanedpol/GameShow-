"use client";

import { useEffect, useMemo, useState } from "react";
import RoomPanel from "./RoomPanel";
import { useGame } from "@/lib/gameStore";
import { BOT_LEVELS, type BotLevel } from "@/lib/bot";
import { MODE_LABEL, STAGE_LABEL } from "@/lib/scoring";
import { DEFAULT_SETTINGS, loadSettings, type GameSettings } from "@/lib/settings";
import { MAX_PARTICIPANTS, TEAM_SIZE, type MatchMode, type Participant } from "@/lib/types";

const MODE_INFO: Array<{ mode: MatchMode; icon: string; detail: string }> = [
  { mode: "solo", icon: "🎯", detail: "ซ้อมทักษะคนเดียว ไม่มีคู่แข่ง เก็บคะแนนตัวเอง" },
  { mode: "bot", icon: "🤖", detail: "หาคู่ไม่ได้ก็ดวลกับบอท เลือกความโหดได้ 3 ระดับ" },
  { mode: "ffa", icon: "⚔️", detail: "2–4 คน ผลัดกันตอบ ตัวใครตัวมัน" },
  { mode: "team", icon: "🤝", detail: `2–4 ทีม ทีมละ ${TEAM_SIZE} คน ช่วยกันคิดได้` },
];

export default function SetupScreen() {
  const { dispatch } = useGame();
  const [mode, setMode] = useState<MatchMode>("bot");
  const [botLevel, setBotLevel] = useState<BotLevel>("ปกติ");
  const [count, setCount] = useState(2);
  const [names, setNames] = useState<string[]>(["", "", "", ""]);
  const [teamNames, setTeamNames] = useState<string[]>(["", "", "", ""]);
  const [members, setMembers] = useState<string[][]>([
    ["", ""],
    ["", ""],
    ["", ""],
    ["", ""],
  ]);
  // อ่านกติกาที่ตั้งไว้จากหลังบ้าน มาแสดงให้ตรงกับที่จะเล่นจริง
  const [cfg, setCfg] = useState<GameSettings>(DEFAULT_SETTINGS);
  useEffect(() => setCfg(loadSettings()), []);

  const slots = mode === "solo" || mode === "bot" ? 1 : count;

  const setName = (i: number, v: string) =>
    setNames((prev) => prev.map((n, idx) => (idx === i ? v : n)));
  const setTeamName = (i: number, v: string) =>
    setTeamNames((prev) => prev.map((n, idx) => (idx === i ? v : n)));
  const setMember = (t: number, m: number, v: string) =>
    setMembers((prev) =>
      prev.map((team, idx) => (idx === t ? team.map((x, j) => (j === m ? v : x)) : team)),
    );

  const ready = useMemo(() => {
    if (mode === "team") {
      return Array.from({ length: slots }).every(
        (_, i) =>
          teamNames[i].trim().length > 0 &&
          members[i].every((m) => m.trim().length > 0),
      );
    }
    return Array.from({ length: slots }).every((_, i) => names[i].trim().length > 0);
  }, [mode, slots, names, teamNames, members]);

  function handleStart() {
    if (!ready) return;

    const participants: Participant[] = [];
    if (mode === "team") {
      for (let i = 0; i < slots; i += 1) {
        participants.push({
          id: `t${i + 1}`,
          name: teamNames[i].trim(),
          kind: "human",
          members: members[i].map((m) => m.trim()),
          score: 0,
          tokens: 0,
        });
      }
    } else {
      for (let i = 0; i < slots; i += 1) {
        participants.push({
          id: `p${i + 1}`,
          name: names[i].trim(),
          kind: "human",
          members: [],
          score: 0,
          tokens: 0,
        });
      }
      if (mode === "bot") {
        participants.push({
          id: "bot",
          name: `บอท (${botLevel})`,
          kind: "bot",
          members: [],
          score: 0,
          tokens: 0,
        });
      }
    }

    dispatch({ type: "START_GAME", mode, participants });
  }

  return (
    <div className="animate-popIn space-y-6">
      <header className="pt-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-sky-300/80">
          Playable Demo
        </p>
        <h1 className="mt-2 text-4xl font-extrabold leading-tight sm:text-5xl">
          <span className="bg-gradient-to-r from-cyan-300 via-sky-300 to-indigo-300 bg-clip-text text-transparent">
            ใบ้จริง...ใบ้หลอก
          </span>
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-300">
          เปิดกล่องคำใบ้จาก AI ได้ {cfg.boxCount} กล่อง —
          แต่ในนั้นมีทั้งของจริงและของปลอมปนกัน หน้าที่ของคุณคือแยกให้ออกก่อนหมดเวลา
        </p>
        {/* ลิงก์หลังบ้านถอดออกจากหน้าแรกแล้ว — เข้าที่ /admin ตรงๆ เท่านั้น */}
      </header>

      {/* เล่นข้ามเครื่อง — วางไว้บนสุดเพราะต้องเปิดห้องก่อนเริ่มเกม */}
      <RoomPanel defaultName={names[0] ?? ""} />

      {/* เลือกโหมด */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-slate-200">เลือกโหมดการแข่ง</h2>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {MODE_INFO.map((m) => {
            const active = mode === m.mode;
            return (
              <button
                key={m.mode}
                onClick={() => setMode(m.mode)}
                className={`rounded-2xl border p-4 text-left transition-all ${
                  active
                    ? "border-sky-400/80 bg-sky-500/15 shadow-glow"
                    : "border-stage-edge bg-white/[0.03] hover:bg-white/[0.06]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xl" aria-hidden="true">
                    {m.icon}
                  </span>
                  <span
                    className={`font-bold ${active ? "text-sky-100" : "text-slate-200"}`}
                  >
                    {MODE_LABEL[m.mode]}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{m.detail}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* ระดับบอท */}
      {mode === "bot" ? (
        <section className="panel space-y-2 p-4">
          <h2 className="text-sm font-bold text-slate-200">ความโหดของบอท</h2>
          <div className="grid grid-cols-3 gap-2">
            {BOT_LEVELS.map((lv) => (
              <button
                key={lv}
                onClick={() => setBotLevel(lv)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                  botLevel === lv
                    ? "border-teal-300/80 bg-teal-400/20 text-teal-100"
                    : "border-stage-edge bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]"
                }`}
              >
                {lv}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">
            บอทตัดสินใจจากความน่าจะเป็นตามระดับความยากของข้อ (ไม่ได้เรียก LLM
            เพื่อไม่ให้กินเวลาในนาฬิกา 60 วินาที)
          </p>
        </section>
      ) : null}

      {/* จำนวนผู้เล่น/ทีม */}
      {mode === "ffa" || mode === "team" ? (
        <section className="panel space-y-2 p-4">
          <h2 className="text-sm font-bold text-slate-200">
            {mode === "team" ? "จำนวนทีม" : "จำนวนผู้เล่น"}
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {[2, 3, MAX_PARTICIPANTS].map((n) => (
              <button
                key={n}
                onClick={() => setCount(n)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                  count === n
                    ? "border-sky-400/80 bg-sky-500/20 text-sky-100"
                    : "border-stage-edge bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]"
                }`}
              >
                {n} {mode === "team" ? "ทีม" : "คน"}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* ชื่อ */}
      <section className="panel space-y-4 p-5">
        {mode === "team"
          ? Array.from({ length: slots }).map((_, i) => (
              <div key={i} className="space-y-2">
                <label className="block text-sm font-semibold text-sky-200">
                  ทีมที่ {i + 1}
                </label>
                <input
                  value={teamNames[i]}
                  onChange={(e) => setTeamName(i, e.target.value)}
                  maxLength={18}
                  placeholder={`ชื่อทีม เช่น ทีมสายฟ้า`}
                  autoComplete="off"
                  className="field"
                />
                <div className="grid grid-cols-2 gap-2">
                  {Array.from({ length: TEAM_SIZE }).map((__, m) => (
                    <input
                      key={m}
                      value={members[i][m]}
                      onChange={(e) => setMember(i, m, e.target.value)}
                      maxLength={16}
                      placeholder={`สมาชิกคนที่ ${m + 1}`}
                      autoComplete="off"
                      className="field text-sm"
                    />
                  ))}
                </div>
              </div>
            ))
          : Array.from({ length: slots }).map((_, i) => (
              <div key={i}>
                <label
                  htmlFor={`name-${i}`}
                  className="mb-1.5 block text-sm font-semibold text-sky-200"
                >
                  {mode === "solo" || mode === "bot"
                    ? "ชื่อเล่นของคุณ"
                    : `ชื่อเล่นผู้เล่น ${i + 1}`}
                </label>
                <input
                  id={`name-${i}`}
                  value={names[i]}
                  onChange={(e) => setName(i, e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && ready && handleStart()}
                  maxLength={16}
                  placeholder="เช่น มายด์"
                  autoComplete="off"
                  className="field"
                />
              </div>
            ))}

        <button onClick={handleStart} disabled={!ready} className="btn-primary w-full text-lg">
          เริ่มเกม
        </button>
        {!ready ? (
          <p className="text-center text-xs text-slate-500">กรอกชื่อให้ครบก่อนเริ่ม</p>
        ) : null}
      </section>

      {/* กติกา */}
      <section className="panel space-y-3 p-5 text-sm leading-relaxed text-slate-300">
        <h2 className="text-base font-bold text-white">กติกาโดยย่อ</h2>
        <ul className="space-y-2">
          <li className="flex gap-2">
            <span className="text-sky-300">▸</span>
            <span>
              แต่ละช่วงมีเวลาและโควตากล่องคำใบ้ไม่เท่ากัน นาฬิกา{" "}
              <b className="text-white">ไม่หยุดพัก</b> และ{" "}
              <b className="text-white">ไม่ตอบทันเวลา = 0 คะแนน</b>
            </span>
          </li>
          <li>
            <div className="ml-5 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-400">
                  <tr>
                    <th className="pb-1 pr-3 font-medium">ช่วง</th>
                    <th className="pb-1 pr-3 font-medium">ข้อ</th>
                    <th className="pb-1 pr-3 font-medium">เวลา</th>
                    <th className="pb-1 pr-3 font-medium">เปิดกล่อง</th>
                    <th className="pb-1 font-medium">คะแนน</th>
                  </tr>
                </thead>
                <tbody className="text-slate-200">
                  {(["warmup", "push", "final"] as const).map((st) => (
                    <tr key={st} className="border-t border-white/5">
                      <td className="py-1 pr-3">{STAGE_LABEL[st]}</td>
                      <td className="tabular py-1 pr-3">{cfg.counts[st]}</td>
                      <td className="tabular py-1 pr-3">{cfg.seconds[st]} วิ</td>
                      <td className="tabular py-1 pr-3">{cfg.maxOpenBoxes[st]} กล่อง</td>
                      <td className="tabular py-1">{cfg.points[st]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </li>
          <li className="flex gap-2">
            <span className="text-sky-300">▸</span>
            <span>
              คำถามมีทั้ง <b className="text-white">ปรนัย</b>,{" "}
              <b className="text-white">อัตนัย</b> (พิมพ์ตอบ ให้ AI ตรวจตามเกณฑ์) และ{" "}
              <b className="text-white">โชว์ความสามารถ</b> (ร้อง/พูด แล้วให้คนอื่นกดดาว)
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-cyan-300">▸</span>
            <span>
              ทุกข้อวางกล่องคำใบ้ไว้ <b className="text-white">{cfg.boxCount} กล่อง</b>{" "}
              ในนั้นมีทั้งใบ้จริงและใบ้หลอก
              <b className="text-white"> อย่างน้อยอย่างละ 1 กล่องเสมอ</b>{" "}
              แต่<b className="text-white">เปิดได้ตามโควตาของช่วงนั้น</b>เท่านั้น
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-cyan-300">▸</span>
            <span>
              เปิด 1 กล่อง หักคะแนนข้อนั้น{" "}
              <b className="text-white">{Math.round(cfg.boxCostRatio * 100)}%</b> —
              ไม่เปิดเลยได้เต็ม 100%
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-teal-300">▸</span>
            <span>
              ตอบถูก <b className="text-white">ข้อแรกของแต่ละช่วง</b> โดยไม่เปิดกล่องเลย →
              ได้โทเคน +1 (สูงสุด {cfg.maxTokens}) ใช้เปิดกล่องฟรี 1 กล่อง
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-indigo-300">▸</span>
            <span>
              ตอบผิดแล้วยังมีเวลาเหลือ อีกฝ่าย{" "}
              <b className="text-white">แย่งตอบ</b> ได้ในเวลาที่เหลือของข้อนั้น
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
