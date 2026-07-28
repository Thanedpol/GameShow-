"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const TICK_MS = 50;

export interface Countdown {
  /** เวลาที่เหลือเป็นมิลลิวินาที */
  remaining: number;
  running: boolean;
  /**
   * เวลาปลายทางจริง (epoch ms) — null เมื่อไม่ได้เดินอยู่
   *
   * มีไว้ให้ส่งข้ามเครื่องได้ตรง ๆ อย่าคำนวณเอาเองจาก Date.now() + remaining
   * เพราะ remaining จะค้างเมื่อเบราว์เซอร์หน่วง timer ของแท็บที่ไม่ได้อยู่หน้าจอ
   * แล้วผลลัพธ์จะเลื่อนไปข้างหน้าเรื่อย ๆ
   */
  deadlineAt: number | null;
  start: (durationMs: number) => void;
  pause: () => void;
  /** เดินต่อ และการันตีว่าเหลืออย่างน้อย minMs */
  resume: (minMs?: number) => void;
  stop: () => void;
}

/**
 * นาฬิกานับถอยหลังที่อิงเวลาจริง (deadline timestamp) จึงไม่สะสม drift
 * แม้ browser จะ throttle timer ตอนสลับแท็บ
 */
export function useCountdown(onExpire?: () => void): Countdown {
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  // เก็บเป็น state คู่กับ ref เพราะ ref ไม่ trigger render — แต่เปลี่ยนแค่ตอน
  // start/pause/resume/stop ซึ่งเป็นเหตุการณ์นาน ๆ ที ไม่ใช่ทุก tick
  const [deadlineAt, setDeadlineAt] = useState<number | null>(null);

  const deadlineRef = useRef<number | null>(null);
  const pausedRef = useRef<number | null>(null);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    const id = window.setInterval(() => {
      const deadline = deadlineRef.current;
      if (deadline === null) return;
      const left = Math.max(0, deadline - Date.now());
      setRemaining(left);
      if (left === 0) {
        deadlineRef.current = null;
        pausedRef.current = null;
        setRunning(false);
        setDeadlineAt(null);
        expireRef.current?.();
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const start = useCallback((durationMs: number) => {
    pausedRef.current = null;
    deadlineRef.current = Date.now() + durationMs;
    setRemaining(durationMs);
    setRunning(true);
    setDeadlineAt(deadlineRef.current);
  }, []);

  const pause = useCallback(() => {
    if (deadlineRef.current === null) return;
    pausedRef.current = Math.max(0, deadlineRef.current - Date.now());
    deadlineRef.current = null;
    setRemaining(pausedRef.current);
    setRunning(false);
    setDeadlineAt(null);
  }, []);

  const resume = useCallback((minMs = 0) => {
    const left = Math.max(pausedRef.current ?? 0, minMs);
    pausedRef.current = null;
    deadlineRef.current = Date.now() + left;
    setRemaining(left);
    setRunning(true);
    setDeadlineAt(deadlineRef.current);
  }, []);

  const stop = useCallback(() => {
    deadlineRef.current = null;
    pausedRef.current = null;
    setRunning(false);
    setDeadlineAt(null);
  }, []);

  return { remaining, running, deadlineAt, start, pause, resume, stop };
}
