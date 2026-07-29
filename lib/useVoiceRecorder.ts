"use client";

import { useCallback, useRef, useState } from "react";

/**
 * อัดเสียงตอนผู้เล่นแสดงสด เพื่อส่งให้ AI ฟังแล้วให้ฟีดแบ็ก
 *
 * ทุกอย่างในนี้ออกแบบให้ "พังแล้วเกมต้องเล่นต่อได้" — ไมค์เป็นของแถม
 * ไม่ใช่เงื่อนไขของการเล่น ถ้าผู้ใช้ไม่ให้สิทธิ์ เบราว์เซอร์ไม่รองรับ
 * หรืออัดแล้วไม่ได้อะไรเลย ก็แค่ข้ามฟีดแบ็กไป แล้วให้กรรมการกดดาวเหมือนเดิม
 */

export type RecorderState =
  | "idle"
  | "requesting"
  | "recording"
  | "stopped"
  | "denied"
  | "unsupported";

export interface RecordedClip {
  base64: string;
  mimeType: string;
  bytes: number;
}

/**
 * เรียงตามความชอบ — ทดสอบกับ Gemini แล้วว่ารับได้ทั้งสามแบบ
 * Chrome/Edge ได้ webm · Firefox ได้ ogg · Safari ได้ mp4
 */
const PREFERRED_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of PREFERRED_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  // เบราว์เซอร์บางตัวไม่ยอมบอกล่วงหน้า ปล่อยให้มันเลือกเองแล้วอ่านค่าทีหลัง
  return "";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("อ่านไฟล์เสียงไม่สำเร็จ"));
    reader.onloadend = () => {
      const result = String(reader.result ?? "");
      // data:audio/webm;base64,xxxxx → เอาเฉพาะส่วนหลังคอมมา
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

export function useVoiceRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  /** ปล่อยไมค์เสมอ ไม่งั้นไฟแสดงสถานะบนเบราว์เซอร์จะค้างติดทั้งเกม */
  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return false;
    }
    const mimeType = pickMimeType();
    if (mimeType === null) {
      setState("unsupported");
      return false;
    }

    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorderRef.current = recorder;
      // เก็บเป็นก้อนทุก 1 วินาที กันเสียทั้งคลิปถ้าแท็บถูกปิดกลางคัน
      recorder.start(1000);
      setState("recording");
      return true;
    } catch {
      releaseMic();
      setState("denied");
      return false;
    }
  }, [releaseMic]);

  const stop = useCallback(async (): Promise<RecordedClip | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      releaseMic();
      setState((s) => (s === "recording" ? "stopped" : s));
      return null;
    }

    const blob = await new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        resolve(chunksRef.current.length ? new Blob(chunksRef.current, { type }) : null);
      };
      recorder.stop();
    });

    releaseMic();
    recorderRef.current = null;
    setState("stopped");

    // คลิปสั้นกว่านี้แทบไม่มีเสียงจริง ส่งไปก็ได้แต่คำว่า "ประเมินไม่ได้"
    if (!blob || blob.size < 2000) return null;

    try {
      return {
        base64: await blobToBase64(blob),
        mimeType: blob.type || "audio/webm",
        bytes: blob.size,
      };
    } catch {
      return null;
    }
  }, [releaseMic]);

  const reset = useCallback(() => {
    recorderRef.current = null;
    chunksRef.current = [];
    releaseMic();
    setState("idle");
  }, [releaseMic]);

  return { state, start, stop, reset };
}
