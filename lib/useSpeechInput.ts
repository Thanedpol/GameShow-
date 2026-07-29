"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { llmRequestPayload } from "./settings";

/**
 * ปุ่มไมค์สำหรับ "พูดแทนพิมพ์" ตอนตอบคำถาม
 *
 * เกมนี้บีบเวลาแรง — ช่วง final เหลือแค่ 20 วินาทีต่อข้อ การพิมพ์ภาษาไทย
 * ให้ทันจึงเป็นคอขวดจริง ปุ่มนี้มีไว้แก้ตรงนั้น
 *
 * มีสองทางเดิน เลือกอัตโนมัติตามเบราว์เซอร์:
 *
 *   live   — Web Speech API (Chrome/Edge) ข้อความขึ้นสด ๆ ระหว่างพูด ฟรี ไม่มีดีเลย์
 *            เหมาะกับเกมจับเวลาที่สุด เพราะเห็นทันทีว่าระบบได้ยินถูกไหม
 *   upload — อัดเสียงแล้วส่งไปถอดที่ /api/transcribe (Safari/Firefox)
 *            ต้องพูดจบก่อนแล้วรออีก 3-5 วินาที จึงเป็นแค่ทางสำรอง
 *
 * ทั้งสองทางพังได้โดยไม่กระทบเกม — ผู้เล่นยังพิมพ์เองได้เสมอ
 */

export type SpeechMode = "live" | "upload" | "none";
export type SpeechState = "idle" | "listening" | "transcribing" | "denied" | "error";

/**
 * TypeScript ยังไม่มีชนิดของ Web Speech API ใน lib มาตรฐาน
 * ประกาศเฉพาะส่วนที่ใช้จริง ไม่ต้องลง @types เพิ่ม
 */
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResult {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const UPLOAD_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickUploadType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of UPLOAD_TYPES) if (MediaRecorder.isTypeSupported(t)) return t;
  return "";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("อ่านไฟล์เสียงไม่สำเร็จ"));
    reader.onloadend = () => {
      const r = String(reader.result ?? "");
      resolve(r.slice(r.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

export interface SpeechInputOptions {
  /**
   * เรียกทุกครั้งที่ได้ข้อความใหม่
   * final = ยืนยันแล้ว · ไม่ final = ข้อความชั่วคราวระหว่างพูด (โหมด live เท่านั้น)
   */
  onText: (text: string, final: boolean) => void;
  lang?: string;
}

export function useSpeechInput({ onText, lang = "th-TH" }: SpeechInputOptions) {
  const [state, setState] = useState<SpeechState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<SpeechMode>("none");

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // เก็บ callback ไว้ใน ref เพื่อให้ start/stop ไม่ต้องสร้างใหม่ทุกครั้งที่ parent re-render
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    setMode(getRecognitionCtor() ? "live" : pickUploadType() !== null ? "upload" : "none");
  }, []);

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startLive = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return false;

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) final += text;
        else interim += text;
      }
      if (final) onTextRef.current(final, true);
      else if (interim) onTextRef.current(interim, false);
    };
    recognition.onerror = (e) => {
      // no-speech เกิดตอนเงียบไปพักหนึ่ง ไม่ใช่ความผิดพลาดจริง อย่าไปตกใจผู้เล่น
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(e.error === "not-allowed" ? "ไม่ได้สิทธิ์ใช้ไมค์" : e.error);
      setState(e.error === "not-allowed" ? "denied" : "error");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setState((s) => (s === "listening" ? "idle" : s));
    };

    recognitionRef.current = recognition;
    recognition.start();
    setState("listening");
    return true;
  }, [lang]);

  const startUpload = useCallback(async () => {
    const mimeType = pickUploadType();
    if (mimeType === null) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorderRef.current = recorder;
      recorder.start(1000);
      setState("listening");
      return true;
    } catch {
      releaseMic();
      setError("ไม่ได้สิทธิ์ใช้ไมค์");
      setState("denied");
      return false;
    }
  }, [releaseMic]);

  const start = useCallback(async () => {
    setError(null);
    if (mode === "live") return startLive();
    if (mode === "upload") return startUpload();
    setError("เบราว์เซอร์นี้ใช้ไมค์ไม่ได้");
    setState("error");
    return false;
  }, [mode, startLive, startUpload]);

  const stop = useCallback(async () => {
    if (mode === "live") {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setState("idle");
      return;
    }

    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      releaseMic();
      setState("idle");
      return;
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

    if (!blob || blob.size < 2000) {
      setState("idle");
      return;
    }

    setState("transcribing");
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio: await blobToBase64(blob),
          mimeType: blob.type || "audio/webm",
          llm: llmRequestPayload("voice"),
        }),
      });
      const data = (await res.json()) as { ok: boolean; text?: string; reason?: string };
      if (data.ok && data.text) {
        onTextRef.current(data.text, true);
        setState("idle");
      } else {
        setError(data.reason ?? "ถอดเสียงไม่สำเร็จ");
        setState("error");
      }
    } catch (e) {
      setError(String(e));
      setState("error");
    }
  }, [mode, releaseMic]);

  /** เลิกใช้แล้วต้องปล่อยไมค์เสมอ ไม่งั้นไฟสถานะบนเบราว์เซอร์ค้างทั้งเกม */
  const cancel = useCallback(() => {
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
    recorderRef.current = null;
    releaseMic();
    setState("idle");
    setError(null);
  }, [releaseMic]);

  useEffect(() => cancel, [cancel]);

  return { state, mode, error, start, stop, cancel };
}
