"use client";

import { useState } from "react";
import { useGame } from "@/lib/gameStore";
import { ANSWER_SECONDS, FINAL_SECONDS, MAX_TOKENS, STEAL_SECONDS } from "@/lib/scoring";

export default function SetupScreen() {
  const { dispatch } = useGame();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");

  const ready = p1.trim().length > 0 && p2.trim().length > 0;

  function handleStart() {
    if (!ready) return;
    dispatch({
      type: "START_GAME",
      player1Name: p1.trim(),
      player2Name: p2.trim(),
    });
  }

  return (
    <div className="animate-popIn space-y-6">
      <header className="pt-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-fuchsia-300/80">
          Playable Demo
        </p>
        <h1 className="mt-2 text-4xl font-extrabold leading-tight sm:text-5xl">
          <span className="bg-gradient-to-r from-fuchsia-400 via-violet-300 to-cyan-300 bg-clip-text text-transparent">
            ใบ้จริง...ใบ้หลอก
          </span>
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-300">
          เกมโชว์ที่ AI จะช่วยใบ้ — แต่บางคำใบ้ตั้งใจหลอก
          หน้าที่ของคุณคือแยกให้ออกว่าอะไรจริง อะไรแค่ฟังดูดี
        </p>
      </header>

      <div className="panel space-y-4 p-5">
        <div>
          <label
            htmlFor="p1"
            className="mb-1.5 block text-sm font-semibold text-fuchsia-200"
          >
            ชื่อเล่นผู้เล่น 1
          </label>
          <input
            id="p1"
            value={p1}
            onChange={(e) => setP1(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ready && handleStart()}
            maxLength={16}
            placeholder="เช่น มายด์"
            autoComplete="off"
            className="w-full rounded-xl border border-stage-edge bg-white/[0.04] px-4 py-3
                       text-base outline-none transition
                       placeholder:text-slate-500 focus:border-fuchsia-400 focus:bg-white/[0.07]"
          />
        </div>

        <div>
          <label
            htmlFor="p2"
            className="mb-1.5 block text-sm font-semibold text-cyan-200"
          >
            ชื่อเล่นผู้เล่น 2
          </label>
          <input
            id="p2"
            value={p2}
            onChange={(e) => setP2(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ready && handleStart()}
            maxLength={16}
            placeholder="เช่น ต้น"
            autoComplete="off"
            className="w-full rounded-xl border border-stage-edge bg-white/[0.04] px-4 py-3
                       text-base outline-none transition
                       placeholder:text-slate-500 focus:border-cyan-400 focus:bg-white/[0.07]"
          />
        </div>

        <button onClick={handleStart} disabled={!ready} className="btn-primary w-full text-lg">
          เริ่มเกม
        </button>
        {!ready ? (
          <p className="text-center text-xs text-slate-500">กรอกชื่อทั้งสองคนก่อนเริ่ม</p>
        ) : null}
      </div>

      <div className="panel space-y-3 p-5 text-sm leading-relaxed text-slate-300">
        <h2 className="text-base font-bold text-white">กติกาโดยย่อ</h2>
        <ul className="space-y-2">
          <li className="flex gap-2">
            <span className="text-fuchsia-300">▸</span>
            <span>
              ผลัดกันตอบคนละข้อ ข้อละ <b className="text-white">{ANSWER_SECONDS} วินาที</b> —
              ช่วง Warm-Up 4 ข้อ ตามด้วย Push Your Luck 4 ข้อ
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-fuchsia-300">▸</span>
            <span>
              <b className="text-white">ใบ้ตรง</b> = เบาะแสจริง แต่ตอบถูกได้คะแนนแค่ครึ่งเดียว
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-fuchsia-300">▸</span>
            <span>
              <b className="text-white">ใบ้ลวง</b> = จริงปนหลอก ตอบถูกได้ 2 เท่า
              ตอบผิดเสีย 2 เท่า
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-fuchsia-300">▸</span>
            <span>
              ตอบผิดเมื่อไร อีกฝ่ายมีสิทธิ์ <b className="text-white">แย่งตอบ</b> ภายใน{" "}
              {STEAL_SECONDS} วินาที ได้คะแนนเต็มข้อนั้นไปแทน
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-amber-300">▸</span>
            <span>
              ตอบถูก <b className="text-white">ข้อแรกของแต่ละช่วง</b> โดยไม่ขอ AI ช่วย →
              ได้โทเคนคำใบ้ +1 (สะสมสูงสุด {MAX_TOKENS}) ใช้จ่าย 1 ชิ้นเพื่อยกเว้นการหัก
              50% ของ &ldquo;ใบ้ตรง&rdquo;
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-cyan-300">▸</span>
            <span>
              ปิดท้ายด้วย <b className="text-white">AI Duel Final</b> — คำใบ้ 3 ชุด
              (จริง 1 หลอก 2) นับถอยหลัง {FINAL_SECONDS} วินาที
              ล็อกคำตอบพร้อมกัน คะแนน 2 เท่า
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
