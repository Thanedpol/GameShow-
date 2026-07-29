"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  isRoomCode,
  normalizeRoomCode,
  type RoomBackend,
  type RoomIntent,
  type RoomLive,
  type RoomMember,
  type RoomView,
} from "./room";
import type { GameState } from "./types";

/**
 * ฝั่ง client ของห้องเล่นข้ามเครื่อง
 *
 * เก็บตัวตนไว้ใน sessionStorage ไม่ใช่ localStorage ตั้งใจให้แต่ละแท็บเป็นคนละคน
 * จะได้เปิดสองแท็บทดสอบสองผู้เล่นบนเครื่องเดียวได้ และปิดแท็บแล้วไม่ค้างเป็นผีในห้อง
 */

const SESSION_KEY = "baijing.room.session";
const POLL_MS = 1500;

export type RoomRole = "host" | "guest";

interface RoomSession {
  code: string;
  memberId: string;
  name: string;
  role: RoomRole;
}

function readSession(): RoomSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RoomSession>;
    if (!isRoomCode(parsed.code) || typeof parsed.memberId !== "string") return null;
    return {
      code: parsed.code,
      memberId: parsed.memberId,
      name: typeof parsed.name === "string" ? parsed.name : "",
      role: parsed.role === "host" ? "host" : "guest",
    };
  } catch {
    return null;
  }
}

function writeSession(session: RoomSession | null): void {
  if (typeof window === "undefined") return;
  if (session) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else window.sessionStorage.removeItem(SESSION_KEY);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export interface RoomContextValue {
  session: RoomSession | null;
  room: RoomView | null;
  members: RoomMember[];
  intents: RoomIntent[];
  backend: RoomBackend | null;
  error: string | null;
  busy: boolean;
  isHost: boolean;
  /** สแนปช็อตจากเจ้าภาพ — ฝั่งผู้ติดตามใช้อันนี้วาดจอแทน state ในเครื่องตัวเอง */
  snapshot: GameState | null;
  /** สถานะสดของข้อที่กำลังเล่น (นาฬิกา + กล่องคำใบ้) */
  live: RoomLive | null;
  createRoom: (name: string) => Promise<string | null>;
  joinRoom: (code: string, name: string) => Promise<boolean>;
  leaveRoom: () => Promise<void>;
  syncSnapshot: (state: GameState) => void;
  syncLive: (live: RoomLive) => void;
  sendIntent: (text: string, questionId: string | null) => Promise<boolean>;
  clearIntents: () => Promise<void>;
}

const RoomContext = createContext<RoomContextValue | null>(null);

export function RoomProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<RoomSession | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // เก็บของล่าสุดที่ส่งไปแล้ว เทียบก่อนส่งรอบใหม่ จะได้ไม่ยิงซ้ำทั้งที่ไม่มีอะไรเปลี่ยน
  const lastSyncRef = useRef<string>("");
  const lastLiveRef = useRef<string>("");

  useEffect(() => {
    setSession(readSession());
  }, []);

  // ── poll สถานะห้อง ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) {
      setRoom(null);
      return;
    }
    let stopped = false;

    const tick = async () => {
      try {
        const res = await fetch(
          `/api/room/${session.code}?memberId=${encodeURIComponent(session.memberId)}`,
          { cache: "no-store" },
        );
        if (stopped) return;
        if (res.status === 404) {
          // ห้องหายไปแล้ว (หมดอายุ หรือเซิร์ฟเวอร์รีสตาร์ทตอนใช้โหมดหน่วยความจำ)
          setError("ห้องหมดอายุหรือถูกปิดไปแล้ว");
          writeSession(null);
          setSession(null);
          return;
        }
        if (!res.ok) return;
        setRoom((await res.json()) as RoomView);
        setError(null);
      } catch {
        /* เน็ตสะดุดชั่วคราว รอบหน้าค่อยลองใหม่ */
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);

    // เบราว์เซอร์หน่วง setInterval ของแท็บที่ไม่ได้อยู่หน้าจอ (บางทีเหลือนาทีละครั้ง)
    // ถ้าไม่ดึงใหม่ตอนกลับมามอง ผู้เล่นที่สลับไปทำอย่างอื่นจะเห็นข้อมูลเก่าค้าง
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void tick();
    };
    // focus ดึงใหม่โดยไม่ต้องเช็ค visibilityState — ได้ focus แปลว่าผู้ใช้อยู่ตรงนั้นแล้ว
    const onFocus = () => void tick();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [session]);

  const createRoom = useCallback(async (name: string): Promise<string | null> => {
    setBusy(true);
    setError(null);
    try {
      const data = await postJson<{ code: string; memberId: string }>("/api/room", { name });
      const next: RoomSession = {
        code: data.code,
        memberId: data.memberId,
        name,
        role: "host",
      };
      writeSession(next);
      setSession(next);
      return data.code;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const joinRoom = useCallback(async (rawCode: string, name: string): Promise<boolean> => {
    const code = normalizeRoomCode(rawCode);
    if (!isRoomCode(code)) {
      setError("รหัสห้องต้องเป็นตัวอักษร 5 ตัว");
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      // ส่ง memberId เดิมไปด้วยถ้าเคยอยู่ห้องนี้ จะได้กลับเข้าที่นั่งเดิมตอนรีเฟรช
      const previous = readSession();
      const data = await postJson<{ memberId: string }>(`/api/room/${code}`, {
        op: "join",
        name,
        memberId: previous?.code === code ? previous.memberId : undefined,
      });
      const next: RoomSession = { code, memberId: data.memberId, name, role: "guest" };
      writeSession(next);
      setSession(next);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const leaveRoom = useCallback(async () => {
    const current = readSession();
    writeSession(null);
    setSession(null);
    setRoom(null);
    setError(null);
    lastSyncRef.current = "";
    if (!current) return;
    try {
      await postJson(`/api/room/${current.code}`, {
        op: "leave",
        memberId: current.memberId,
      });
    } catch {
      /* ออกจากห้องฝั่งเราไปแล้ว ฝั่งเซิร์ฟเวอร์เดี๋ยวก็หมดอายุเอง */
    }
  }, []);

  /**
   * ตัดของหนักออกจากสแนปช็อตก่อนส่งขึ้นห้อง
   *
   * ภาพโจทย์เป็น data URI ราว 450KB ต่อภาพ เกมหนึ่งมีได้ถึง 6-7 ภาพ
   * ถ้าส่งไปทั้งก้อนจะกลายเป็นสแนปช็อต 3MB ที่ยิงขึ้น Redis ทุกครั้งที่สถานะเปลี่ยน
   * — ทั้งเกินขนาดที่ Upstash รับไหวและกินโควตาจนหมดในไม่กี่เกม
   *
   * ผู้ติดตามจึงไม่เห็นภาพโจทย์ (เห็นแค่ตัวคำถามกับคำใบ้ที่เป็นข้อความ)
   * แลกกับการที่ห้องยังทำงานได้จริง — ถ้าจะให้เห็นภาพด้วยต้องมีที่เก็บไฟล์จริง
   * ซึ่งเกินขอบเขตของ prototype ที่ตั้งใจไม่มีฐานข้อมูล
   */
  const stripHeavyFields = (state: GameState): GameState => ({
    ...state,
    questions: state.questions.map(({ imageUrl, imagePrompt, ...rest }) =>
      imageUrl || imagePrompt ? rest : rest,
    ),
  });

  const syncSnapshot = useCallback(
    (state: GameState) => {
      if (!session || session.role !== "host") return;
      const trimmed = stripHeavyFields(state);
      const serialized = JSON.stringify(trimmed);
      if (serialized === lastSyncRef.current) return;
      lastSyncRef.current = serialized;
      void postJson(`/api/room/${session.code}`, {
        op: "sync",
        memberId: session.memberId,
        snapshot: trimmed,
      }).catch(() => {
        // ส่งไม่สำเร็จ ล้างตัวเทียบทิ้งเพื่อให้รอบหน้าลองส่งใหม่
        lastSyncRef.current = "";
      });
    },
    [session],
  );

  const syncLive = useCallback(
    (live: RoomLive) => {
      if (!session || session.role !== "host") return;
      const serialized = JSON.stringify(live);
      if (serialized === lastLiveRef.current) return;
      lastLiveRef.current = serialized;
      void postJson(`/api/room/${session.code}`, {
        op: "sync",
        memberId: session.memberId,
        live,
      }).catch(() => {
        lastLiveRef.current = "";
      });
    },
    [session],
  );

  const sendIntent = useCallback(
    async (text: string, questionId: string | null): Promise<boolean> => {
      if (!session) return false;

      const send = (memberId: string) =>
        postJson(`/api/room/${session.code}`, {
          op: "intent",
          memberId,
          kind: "suggest",
          text,
          questionId,
        });

      try {
        await send(session.memberId);
        return true;
      } catch (first) {
        // หลุดจากห้องไปแล้ว (เช่นหายไปนานจนโดนตัด) — เข้าใหม่เงียบ ๆ แล้วลองอีกครั้ง
        // ดีกว่าโยน error ใส่หน้าผู้เล่นทั้งที่แค่กลับมาช้าไปหน่อย
        try {
          const rejoined = await postJson<{ memberId: string }>(
            `/api/room/${session.code}`,
            { op: "join", name: session.name, memberId: session.memberId },
          );
          const next = { ...session, memberId: rejoined.memberId };
          writeSession(next);
          setSession(next);
          await send(rejoined.memberId);
          return true;
        } catch {
          setError(first instanceof Error ? first.message : String(first));
          return false;
        }
      }
    },
    [session],
  );

  const clearIntents = useCallback(async () => {
    if (!session || session.role !== "host") return;
    try {
      await postJson(`/api/room/${session.code}`, {
        op: "clear",
        memberId: session.memberId,
      });
    } catch {
      /* ไม่เป็นไร รอบหน้าค่อยล้างใหม่ */
    }
  }, [session]);

  const value = useMemo<RoomContextValue>(
    () => ({
      session,
      room,
      members: room?.members ?? [],
      intents: room?.intents ?? [],
      backend: room?.backend ?? null,
      error,
      busy,
      isHost: session?.role === "host",
      snapshot: room?.snapshot ?? null,
      live: room?.live ?? null,
      createRoom,
      joinRoom,
      leaveRoom,
      syncSnapshot,
      syncLive,
      sendIntent,
      clearIntents,
    }),
    [
      session,
      room,
      error,
      busy,
      createRoom,
      joinRoom,
      leaveRoom,
      syncSnapshot,
      syncLive,
      sendIntent,
      clearIntents,
    ],
  );

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoom(): RoomContextValue {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error("useRoom ต้องถูกเรียกภายใน <RoomProvider>");
  return ctx;
}
