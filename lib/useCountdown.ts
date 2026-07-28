"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const TICK_MS = 50;

export interface Countdown {
  /** เวลาที่เหลือเป็นมิลลิวินาที */
  remaining: number;
  running: boolean;
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
  }, []);

  const pause = useCallback(() => {
    if (deadlineRef.current === null) return;
    pausedRef.current = Math.max(0, deadlineRef.current - Date.now());
    deadlineRef.current = null;
    setRemaining(pausedRef.current);
    setRunning(false);
  }, []);

  const resume = useCallback((minMs = 0) => {
    const left = Math.max(pausedRef.current ?? 0, minMs);
    pausedRef.current = null;
    deadlineRef.current = Date.now() + left;
    setRemaining(left);
    setRunning(true);
  }, []);

  const stop = useCallback(() => {
    deadlineRef.current = null;
    pausedRef.current = null;
    setRunning(false);
  }, []);

  return { remaining, running, start, pause, resume, stop };
}
