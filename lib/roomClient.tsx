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
  type RoomDraft,
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

/**
 * ห้องหายไปนานแค่ไหนถึงจะยอมแพ้
 *
 * ตอนใช้โหมดหน่วยความจำ เซิร์ฟเวอร์ลืมห้องได้ทุกเมื่อ (รีสตาร์ท / instance ใหม่)
 * เจ้าภาพถือสถานะจริงอยู่แล้วจึงปลุกห้องคืนได้ภายในรอบ poll เดียว (~1.5 วิ)
 * ผู้ติดตามจึงต้องรอ ไม่ใช่โดนเตะออกทันทีที่เจอ 404 ครั้งแรกแบบเดิม
 * ซึ่งทำให้ทั้งทีมหลุดจากห้องกลางเกมโดยที่ไม่มีใครทำอะไรผิด
 */
const ROOM_GRACE_MS = 30_000;

/**
 * ส่งข้อความที่กำลังพิมพ์ได้ไม่เกิน 1 ครั้งต่อวินาที
 *
 * คนพิมพ์เร็ว ๆ ยิงได้เป็นสิบครั้งต่อวินาทีถ้าไม่หน่วง ซึ่งกินโควตา Redis
 * โดยไม่ได้อะไรเพิ่ม เพราะอีกฝั่งก็ poll ทุก 1.5 วินาทีอยู่ดี
 * มองไม่เห็นความต่างระหว่างส่งทุกตัวอักษรกับส่งวินาทีละครั้ง
 */
const DRAFT_SEND_MS = 1_000;

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
  /** ข้อความที่คนอื่นกำลังพิมพ์ — ว่างเมื่อไม่ได้อยู่ในช่วงตอบ */
  drafts: RoomDraft[];
  backend: RoomBackend | null;
  error: string | null;
  busy: boolean;
  /** เซิร์ฟเวอร์ลืมห้องอยู่ กำลังพยายามต่อกลับ — ยังไม่ถือว่าหลุดจากห้อง */
  reconnecting: boolean;
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
  /**
   * กระจายข้อความที่กำลังพิมพ์ให้คนอื่นเห็น · ข้อความว่าง = ลบของตัวเองทิ้ง
   * ฝั่งรับ provider เปิดให้เองเมื่อห้องอยู่ในช่วงตอบข้อ ไม่ต้องสั่งเพิ่ม
   */
  sendDraft: (text: string, questionId: string | null) => void;
  clearIntents: () => Promise<void>;
}

const RoomContext = createContext<RoomContextValue | null>(null);

export function RoomProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<RoomSession | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  // เก็บของล่าสุดที่ส่งไปแล้ว เทียบก่อนส่งรอบใหม่ จะได้ไม่ยิงซ้ำทั้งที่ไม่มีอะไรเปลี่ยน
  const lastSyncRef = useRef<string>("");
  const lastLiveRef = useRef<string>("");

  // ของที่เจ้าภาพต้องใช้ตอนปลุกห้องคืน — เก็บเป็น ref ไม่ใช่ state
  // เพราะต้องอ่านค่าล่าสุดได้จากใน callback ที่ผูก closure ไว้แล้ว
  const roomRef = useRef<RoomView | null>(null);
  const snapshotRef = useRef<GameState | null>(null);
  const liveRef = useRef<RoomLive | null>(null);
  /** เห็น 404 ครั้งแรกตอนไหน — null = ตอนนี้ห้องยังอยู่ดี */
  const missingSinceRef = useRef<number | null>(null);
  /** กันไม่ให้ยิงขอที่นั่งคืนรัว ๆ ทุกรอบ poll ตอนที่ห้องเต็มหรือเซิร์ฟเวอร์ไม่ยอมรับ */
  const rejoinAtRef = useRef<number>(0);

  // ── ข้อความที่กำลังพิมพ์ ──────────────────────────────────────────────────
  /**
   * เก็บเป็น ref ไม่ใช่ state เพราะทั้งสามตัวถูกอ่าน/เขียนจากใน timer
   * ถ้าใช้ state จะต้องผูก dependency ใหม่ทุกครั้งที่พิมพ์ ซึ่งรีเซ็ต timer ทิ้ง
   */
  const draftTextRef = useRef<string>("");
  const draftQuestionRef = useRef<string | null>(null);
  const draftSentRef = useRef<string>("");

  useEffect(() => {
    setSession(readSession());
  }, []);

  /**
   * ปลุกห้องที่เซิร์ฟเวอร์ลืมไปกลับมาด้วยรหัสเดิม
   *
   * ทำได้เพราะเกมนี้เป็นแบบ "เจ้าภาพถือสถานะ" อยู่แล้ว (ดู lib/room.ts)
   * เครื่องเจ้าภาพมีทั้งรายชื่อสมาชิก สแนปช็อตเกม และสถานะสดครบอยู่ในมือ
   * ฝั่งเซิร์ฟเวอร์จะเขียนให้เฉพาะตอนที่ห้องหายไปจริง ๆ เท่านั้น
   */
  const reviveRoom = useCallback(async (s: RoomSession): Promise<boolean> => {
    if (s.role !== "host") return false;
    const known = roomRef.current;
    const now = Date.now();
    try {
      await postJson(`/api/room/${s.code}`, {
        op: "restore",
        memberId: s.memberId,
        room: {
          code: s.code,
          createdAt: known?.createdAt ?? now,
          updatedAt: now,
          version: known?.version ?? 1,
          hostId: s.memberId,
          members:
            known && known.members.length > 0
              ? known.members
              : [{ id: s.memberId, name: s.name, isHost: true, lastSeen: now }],
          snapshot: snapshotRef.current,
          live: liveRef.current,
        },
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  /**
   * ดึง draft เฉพาะตอนที่ห้องกำลังตอบข้ออยู่ — provider ตัดสินเอง
   *
   * เดิมให้ลูกคอมโพเนนต์เป็นคนสั่งเปิด/ปิดผ่าน setDraftsWanted แต่พึ่งพาการที่
   * ทั้ง QuestionScreen และ FollowerScreen ต้องเรียกให้ถูกจังหวะ ซึ่งดีบั๊กยากมาก
   * เวลามันไม่ทำงาน (ต้องไล่ว่าใครเรียก ตอนไหน state ไปถึงไหนแล้ว)
   *
   * provider มี room.live อยู่ในมือแล้ว จึงรู้เองได้ว่ากำลังตอบข้ออยู่ไหม
   * แหล่งความจริงเดียว ไม่ต้องประสานข้ามคอมโพเนนต์ และประหยัดโควตาเท่าเดิม
   */
  const liveStep = room?.live?.step;
  const draftsWantedRef = useRef(false);
  draftsWantedRef.current = liveStep === "answering" || liveStep === "performing";

  // ── poll สถานะห้อง ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) {
      setRoom(null);
      roomRef.current = null;
      missingSinceRef.current = null;
      setReconnecting(false);
      return;
    }
    let stopped = false;

    // afterRevive กันลูปไม่รู้จบ: ถ้าปลุกห้องแล้ว GET ยังไม่เจออีก (เช่นคำขอไปคนละ
    // instance บน Vercel) ให้ปล่อยรอรอบถัดไปตามจังหวะปกติ ห้ามยิงซ้ำทันที
    const tick = async (afterRevive = false) => {
      try {
        const res = await fetch(
          `/api/room/${session.code}?memberId=${encodeURIComponent(session.memberId)}` +
            (draftsWantedRef.current ? "&drafts=1" : ""),
          { cache: "no-store" },
        );
        if (stopped) return;

        if (res.status === 404) {
          // เซิร์ฟเวอร์ไม่รู้จักห้องนี้ — ส่วนใหญ่คือมันลืมไป ไม่ใช่ห้องถูกปิดจริง
          // เจ้าภาพปลุกคืนได้เลยเพราะถือสถานะจริงอยู่ ส่วนผู้ติดตามต้องรอเจ้าภาพ
          if (!afterRevive && session.role === "host" && (await reviveRoom(session))) {
            if (stopped) return;
            missingSinceRef.current = null;
            void tick(true);
            return;
          }
          if (stopped) return;
          missingSinceRef.current ??= Date.now();
          if (Date.now() - missingSinceRef.current < ROOM_GRACE_MS) {
            setReconnecting(true);
            return;
          }
          setError("ห้องหมดอายุหรือถูกปิดไปแล้ว");
          writeSession(null);
          setSession(null);
          setReconnecting(false);
          return;
        }

        if (!res.ok) return;
        const view = (await res.json()) as RoomView;
        roomRef.current = view;
        missingSinceRef.current = null;
        setReconnecting(false);
        setRoom(view);
        setError(null);

        // ห้องกลับมาแล้วแต่ไม่มีชื่อเราอยู่ในนั้น — เกิดตอนเจ้าภาพรีเฟรชหน้าไปพร้อมกับ
        // ที่เซิร์ฟเวอร์ลืมห้อง เจ้าภาพจึงปลุกคืนได้แค่ตัวเอง ขอที่นั่งคืนเงียบ ๆ
        // ดีกว่าปล่อยให้ผู้ติดตามนั่งดูห้องที่ตัวเองส่งอะไรเข้าไปไม่ได้
        const seated = view.members.some((m) => m.id === session.memberId);
        if (!seated && Date.now() - rejoinAtRef.current > 5_000) {
          rejoinAtRef.current = Date.now();
          try {
            const back = await postJson<{ memberId: string }>(`/api/room/${session.code}`, {
              op: "join",
              name: session.name,
              memberId: session.memberId,
            });
            if (stopped) return;
            const next = { ...session, memberId: back.memberId };
            writeSession(next);
            setSession(next);
          } catch {
            /* ห้องอาจเต็ม — รอบหน้าค่อยลองใหม่ */
          }
        }
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
  }, [session, reviveRoom]);

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
    setReconnecting(false);
    lastSyncRef.current = "";
    lastLiveRef.current = "";
    roomRef.current = null;
    snapshotRef.current = null;
    liveRef.current = null;
    missingSinceRef.current = null;
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

  /**
   * ส่งของขึ้นห้องแบบเจ้าภาพ — ล้มเหลวแล้วปลุกห้องคืนก่อนแล้วค่อยลองใหม่หนึ่งครั้ง
   * ถ้าห้องหายไปจริง reviveRoom จะพาสแนปช็อตล่าสุดขึ้นไปให้อยู่แล้ว
   */
  const hostSync = useCallback(
    async (s: RoomSession, payload: Record<string, unknown>): Promise<boolean> => {
      const send = () =>
        postJson(`/api/room/${s.code}`, { op: "sync", memberId: s.memberId, ...payload });
      try {
        await send();
        return true;
      } catch {
        if (!(await reviveRoom(s))) return false;
        try {
          await send();
          return true;
        } catch {
          return false;
        }
      }
    },
    [reviveRoom],
  );

  const syncSnapshot = useCallback(
    (state: GameState) => {
      if (!session || session.role !== "host") return;
      const trimmed = stripHeavyFields(state);
      const serialized = JSON.stringify(trimmed);
      if (serialized === lastSyncRef.current) return;
      lastSyncRef.current = serialized;
      // เก็บไว้ให้ reviveRoom หยิบไปใช้ ต้องเซ็ตก่อนยิงเสมอ ไม่งั้นตอนปลุกห้อง
      // จะได้สถานะเก่ากว่าที่ผู้เล่นเห็นอยู่จริงหนึ่งจังหวะ
      snapshotRef.current = trimmed;
      void hostSync(session, { snapshot: trimmed }).then((ok) => {
        // ส่งไม่สำเร็จ ล้างตัวเทียบทิ้งเพื่อให้รอบหน้าลองส่งใหม่
        if (!ok) lastSyncRef.current = "";
      });
    },
    [session, hostSync],
  );

  const syncLive = useCallback(
    (live: RoomLive) => {
      if (!session || session.role !== "host") return;
      const serialized = JSON.stringify(live);
      if (serialized === lastLiveRef.current) return;
      lastLiveRef.current = serialized;
      liveRef.current = live;
      void hostSync(session, { live }).then((ok) => {
        if (!ok) lastLiveRef.current = "";
      });
    },
    [session, hostSync],
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

  /**
   * เก็บข้อความไว้เฉย ๆ แล้วให้ timer เป็นคนส่ง — ไม่ยิงทันทีที่พิมพ์
   * ตัวจับเวลาด้านล่างจะส่งให้วินาทีละครั้งเฉพาะตอนที่ข้อความเปลี่ยนจริง
   */
  const sendDraft = useCallback((text: string, questionId: string | null) => {
    draftTextRef.current = text;
    draftQuestionRef.current = questionId;
  }, []);

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => {
      const text = draftTextRef.current.trim().slice(0, 1200);
      const questionId = draftQuestionRef.current;
      /**
       * ตัวเทียบต้องรวม questionId ด้วย ไม่ใช่เทียบแค่ข้อความ
       *
       * ช่องพิมพ์ของผู้ติดตามไม่ได้ถูกล้างตอนขึ้นข้อใหม่ ถ้าเทียบแค่ข้อความ
       * พอเปลี่ยนข้อแล้วข้อความเท่าเดิม ระบบจะไม่ส่งอะไรเลย draft บนเซิร์ฟเวอร์
       * จึงค้างติดหมายเลขข้อเก่า แล้วโดนตัวกรองฝั่งแสดงผลทิ้งทั้งที่คนยังพิมพ์อยู่จริง
       */
      const key = `${questionId ?? ""}\n${text}`;
      if (key === draftSentRef.current) return;
      draftSentRef.current = key;
      void postJson(`/api/room/${session.code}`, {
        op: "draft",
        memberId: session.memberId,
        text,
        questionId,
      }).catch(() => {
        // ส่งไม่สำเร็จ ล้างตัวเทียบเพื่อให้รอบหน้าลองใหม่
        draftSentRef.current = "";
      });
    }, DRAFT_SEND_MS);
    return () => window.clearInterval(timer);
  }, [session]);

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
      drafts: (room?.drafts ?? []).filter((d) => d.memberId !== session?.memberId),
      backend: room?.backend ?? null,
      error,
      busy,
      reconnecting,
      isHost: session?.role === "host",
      snapshot: room?.snapshot ?? null,
      live: room?.live ?? null,
      createRoom,
      joinRoom,
      leaveRoom,
      syncSnapshot,
      syncLive,
      sendIntent,
      sendDraft,
      clearIntents,
    }),
    [
      session,
      room,
      error,
      busy,
      reconnecting,
      createRoom,
      joinRoom,
      leaveRoom,
      syncSnapshot,
      syncLive,
      sendIntent,
      sendDraft,
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
