"use client";

import { useEffect, useMemo, useState } from "react";
import RoomPanel from "./RoomPanel";
import { useRoom } from "@/lib/roomClient";
import { useGame } from "@/lib/gameStore";
import { BOT_LEVELS, type BotLevel } from "@/lib/bot";
import { prefetchReady, startPrefetch, takeQuestions } from "@/lib/questionPrefetch";
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
  const { isHost } = useRoom();
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
  const [starting, setStarting] = useState(false);
  const [waited, setWaited] = useState(0);
  /** ชุดคำถามเตรียมเสร็จแล้วหรือยัง — ใช้บอกสถานะ "ก่อน" กดปุ่ม ไม่ใช่หลังกด */
  const [prepped, setPrepped] = useState(false);
  useEffect(() => setCfg(loadSettings()), []);

  /**
   * เริ่มแต่งคำถามทันทีที่เปิดหน้านี้ ไม่รอให้ผู้เล่นแตะอะไรก่อน
   *
   * เดิมรอจังหวะแตะหน้าจอครั้งแรกเพื่อไม่ให้คนที่เปิดมาดูเฉย ๆ เสียโทเคน
   * แต่การแต่งคำถามใช้เวลาราว 45 วินาที คนที่กรอกชื่อเร็วจึงไปเจอหน้าจอรอ
   * หลังกดปุ่มอยู่ดี ซึ่งเป็นจังหวะที่แย่ที่สุดเพราะเขาพร้อมเล่นแล้ว
   *
   * ผู้ใช้เลือกให้ย้ายการรอมาไว้ "ก่อนกดปุ่ม" แทน — เปิดหน้ามาก็เริ่มคิดเลย
   * กว่าจะเลือกโหมดและกรอกชื่อเสร็จ ชุดคำถามมักพร้อมแล้ว กดปุ่มแล้วเข้าเกมทันที
   * แลกกับการที่คนเปิดมาดูเฉย ๆ ก็กินโทเคนไปหนึ่งชุด
   */
  useEffect(() => {
    startPrefetch();
    if (prefetchReady()) {
      setPrepped(true);
      return;
    }
    const timer = window.setInterval(() => {
      setWaited((n) => n + 1);
      if (prefetchReady()) {
        setPrepped(true);
        window.clearInterval(timer);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const slots = mode === "solo" || mode === "bot" ? 1 : count;

  const setName = (i: number, v: string) =>
    setNames((prev) => prev.map((n, idx) => (idx === i ? v : n)));
  const setTeamName = (i: number, v: string) =>
    setTeamNames((prev) => prev.map((n, idx) => (idx === i ? v : n)));
  const setMember = (t: number, m: number, v: string) =>
    setMembers((prev) =>
      prev.map((team, idx) => (idx === t ? team.map((x, j) => (j === m ? v : x)) : team)),
    );

  /**
   * โหมดทีมต้องเปิดห้องก่อนถึงจะเริ่มได้
   *
   * ทีมละ 2 คน คนที่สองต้องใช้อีกเครื่องเพื่อดูโจทย์และส่งข้อเสนอมาช่วยคิด
   * ถ้าเริ่มเกมได้โดยไม่มีห้อง เพื่อนร่วมทีมก็เข้ามาไม่ได้เลย เท่ากับโหมดทีม
   * กลายเป็นโหมดเดี่ยวที่พิมพ์ชื่อเยอะกว่าเดิมเฉย ๆ
   */
  const needsRoom = mode === "team" && !isHost;

  /**
   * บอกให้ชัดว่า "ยังขาดช่องไหน" ไม่ใช่แค่ "กรอกชื่อให้ครบ"
   *
   * โหมดทีม 2 ทีมมีช่องให้กรอก 6 ช่อง (ชื่อทีม + สมาชิกสองคน คูณสองทีม)
   * ข้อความเดิมบอกแค่ว่ายังไม่ครบ ผู้ใช้ต้องไล่หาเองว่าเว้นช่องไหนไว้
   * ซึ่งบนมือถือที่ต้องเลื่อนจอ ทำให้ดูเหมือนปุ่มเริ่มเกม "หายไป" ทั้งที่แค่กดไม่ได้
   */
  const missing = useMemo(() => {
    const gaps: string[] = [];
    if (mode === "team") {
      for (let i = 0; i < slots; i += 1) {
        if (!teamNames[i].trim()) gaps.push(`ชื่อทีมที่ ${i + 1}`);
        members[i].forEach((m, j) => {
          if (!m.trim()) gaps.push(`สมาชิกทีม ${i + 1} คนที่ ${j + 1}`);
        });
      }
    } else {
      for (let i = 0; i < slots; i += 1) {
        if (!names[i].trim()) gaps.push(slots > 1 ? `ชื่อผู้เล่นคนที่ ${i + 1}` : "ชื่อของคุณ");
      }
    }
    return gaps;
  }, [mode, slots, names, teamNames, members]);

  const ready = useMemo(
    () => missing.length === 0 && !(mode === "team" && !isHost),
    [missing, mode, isHost],
  );

  async function handleStart() {
    if (!ready || starting) return;

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

    // ปกติชุดคำถามเตรียมเสร็จตั้งแต่ตอนเลือกโหมดแล้ว บรรทัดนี้จึงคืนค่าทันที
    // จะรอจริงก็เฉพาะตอนที่ผู้เล่นกรอกชื่อเร็วกว่าที่ AI แต่งคำถามเสร็จ
    setStarting(true);
    try {
      const prepared = await takeQuestions();
      dispatch({ type: "START_GAME", mode, participants, questions: prepared.questions });
    } finally {
      setStarting(false);
    }
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
          <p className="text-xs text-slate-500">
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
                  onKeyDown={(e) => e.key === "Enter" && ready && void handleStart()}
                  maxLength={16}
                  placeholder="เช่น มายด์"
                  autoComplete="off"
                  className="field"
                />
              </div>
            ))}

        {/*
          สถานะการเตรียมคำถามอยู่ "เหนือปุ่ม" และขึ้นตั้งแต่ยังไม่กด
          ผู้ใช้ขอไว้ว่าไม่อยากเห็นข้อความแต่งคำถามตอนกดเริ่มเกม เพราะกดแล้ว
          ต้องการให้พร้อมเล่นเลย — การรอจึงต้องเกิดตอนที่เขายังกรอกชื่ออยู่
          ไม่ใช่ตอนที่เขาพร้อมแล้ว
        */}
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
              <b className="text-white">โชว์ความสามารถ</b> (ร้อง/พูด/พิตช์ แล้วพิมพ์สรุปให้ AI ตรวจ)
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
      {/*
        แถบเริ่มเกมตรึงไว้ล่างจอ

        วัดจริงบนมือถือ (375x812) ตอนเปิดห้องแล้วมีคนเข้ามาร่วม: ปุ่มเริ่มเกม
        อยู่ที่ y=1533px บนหน้าที่สูง 2383px แปลว่าต้องเลื่อนลงเกือบ 2 เท่าของจอ
        กว่าจะเจอ — กล่อง "เล่นข้ามเครื่อง" ที่โผล่รหัสห้องกับรายชื่อสมาชิก
        ดันทุกอย่างลงไป ผู้ใช้จึงรายงานว่า "ไม่มีปุ่มเริ่มเกมเลย" ทั้งที่ปุ่มมีอยู่

        เป็นอาการเดียวกับปุ่ม "ส่งคำตอบ" ในหน้าเล่นเกมที่เคยแก้ด้วยวิธีนี้แล้ว
        ต้องเป็นลูกของกล่องนอกสุด ไม่ใช่ซ่อนใน section ย่อย เพราะ sticky
        ยึดกับกล่องแม่ ถ้าแม่เตี้ยกว่าจอมันก็ไม่มีที่ให้ติด
      */}
      <div
        className="sticky bottom-0 z-30 -mx-4 border-t border-stage-edge/70
                   bg-stage-bg/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]
                   pt-3 backdrop-blur sm:-mx-6 sm:px-6"
      >
        <p
          className={`text-center text-xs ${prepped ? "text-teal-300" : "text-slate-400"}`}
          aria-live="polite"
        >
          {prepped ? (
            <>✓ ชุดคำถามใหม่พร้อมแล้ว</>
          ) : (
            <>
              <span className="mr-1 inline-block animate-pulse">●</span>
              กำลังเตรียมชุดคำถามให้เบื้องหลัง · {waited} วินาที
            </>
          )}
        </p>

        <button
          onClick={() => void handleStart()}
          disabled={!ready || starting}
          className="btn-primary mt-2 w-full text-lg disabled:opacity-60"
        >
          {starting ? "กำลังเข้าเกม..." : "เริ่มเกม"}
        </button>
        {!ready ? (
          <p className="mt-1.5 text-center text-xs text-amber-200/90">
            {needsRoom
              ? "โหมดทีมต้องเปิดห้องก่อน — เลื่อนขึ้นไปที่ “เล่นข้ามเครื่อง” แล้วกดเปิดห้องใหม่ เพื่อให้เพื่อนร่วมทีมเข้ามาช่วยคิดจากอีกเครื่องได้"
              : `ปุ่มยังกดไม่ได้เพราะยังไม่ได้กรอก: ${missing.join(" · ")}`}
          </p>
        ) : null}
      </div>
    </div>
  );
}
