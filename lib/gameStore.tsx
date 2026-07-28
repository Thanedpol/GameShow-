"use client";

import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import { drawQuestions } from "./questions";
import {
  MAX_TOKENS,
  activePlayerFor,
  scoreForAnswer,
  scoreForFinal,
  scoreForSteal,
  stageKey,
} from "./scoring";
import type {
  FinalResult,
  HintRequest,
  HintType,
  PlayerId,
  RoundResult,
  SessionState,
} from "./types";

const initialState: SessionState = {
  player1Name: "",
  player2Name: "",
  currentQuestionIndex: 0,
  player1Score: 0,
  player2Score: 0,
  player1Tokens: 0,
  player2Tokens: 0,
  hintHistory: [],
  phase: "setup",
  questions: [],
  finalQuestion: null,
  roundLog: [],
  finalResult: null,
  stageOpened: {},
};

export interface ResolveRoundPayload {
  answeredChoice: string | null;
  hintType: HintType | null;
  tokenSpent: boolean;
  timedOut: boolean;
  /** ข้อมูลคำใบ้ที่ขอไป (ถ้ามี) เพื่อบันทึกลง hintHistory */
  hint?: {
    text: string;
    revealToken: string;
    hintId: string;
  };
}

export interface ResolveStealPayload {
  stealChoice: string | null;
}

export interface ResolveFinalPayload {
  player1Choice: string | null;
  player2Choice: string | null;
  revealToken: string | null;
  /** hint ที่แต่ละฝ่ายเลือก "เชื่อ" — บันทึกลง hintHistory เพื่อใช้ตอน debrief */
  hintsUsed?: Array<{ player: PlayerId; text: string; revealToken: string; hintId: string }>;
}

export type GameAction =
  | { type: "START_GAME"; player1Name: string; player2Name: string }
  | { type: "RESOLVE_ROUND"; payload: ResolveRoundPayload }
  | { type: "RESOLVE_STEAL"; payload: ResolveStealPayload }
  | { type: "NEXT_QUESTION" }
  | { type: "RESOLVE_FINAL"; payload: ResolveFinalPayload }
  | { type: "GO_DEBRIEF" }
  | { type: "RESET" };

function addScore(state: SessionState, player: PlayerId, delta: number): SessionState {
  return player === 1
    ? { ...state, player1Score: state.player1Score + delta }
    : { ...state, player2Score: state.player2Score + delta };
}

function tokensOf(state: SessionState, player: PlayerId): number {
  return player === 1 ? state.player1Tokens : state.player2Tokens;
}

function withToken(state: SessionState, player: PlayerId, delta: number): SessionState {
  const next = Math.max(0, Math.min(MAX_TOKENS, tokensOf(state, player) + delta));
  return player === 1
    ? { ...state, player1Tokens: next }
    : { ...state, player2Tokens: next };
}

function reducer(state: SessionState, action: GameAction): SessionState {
  switch (action.type) {
    case "START_GAME": {
      const { main, final } = drawQuestions();
      return {
        ...initialState,
        player1Name: action.player1Name,
        player2Name: action.player2Name,
        phase: "playing",
        questions: main,
        finalQuestion: final,
      };
    }

    case "RESOLVE_ROUND": {
      const question = state.questions[state.currentQuestionIndex];
      if (!question) return state;

      const player = activePlayerFor(state.currentQuestionIndex);
      const { answeredChoice, hintType, tokenSpent, timedOut, hint } = action.payload;
      const wasCorrect = !timedOut && answeredChoice === question.correctAnswer;

      const delta = scoreForAnswer({
        pointValue: question.pointValue,
        hintType,
        tokenSpent,
        correct: wasCorrect,
      });

      let next: SessionState = addScore(state, player, delta);

      // จ่ายโทเคน (ใช้ได้เฉพาะกับ "ใบ้ตรง")
      if (tokenSpent && hintType === "ตรง") {
        next = withToken(next, player, -1);
      }

      // โทเคนคำใบ้: ตอบถูกในข้อแรกของช่วงนั้น โดยไม่ขอ AI ช่วย → +1 (สูงสุด 3)
      const key = stageKey(player, question.stage);
      if (!next.stageOpened[key]) {
        next = { ...next, stageOpened: { ...next.stageOpened, [key]: true } };
        if (wasCorrect && hintType === null) {
          next = withToken(next, player, +1);
        }
      }

      if (hint && hintType) {
        const record: HintRequest = {
          questionId: question.id,
          player,
          hintType,
          aiGeneratedText: hint.text,
          wasCorrect,
          revealToken: hint.revealToken,
          hintId: hint.hintId,
        };
        next = { ...next, hintHistory: [...next.hintHistory, record] };
      }

      const round: RoundResult = {
        questionId: question.id,
        stage: question.stage,
        prompt: question.prompt,
        correctAnswer: question.correctAnswer,
        answeringPlayer: player,
        answeredChoice,
        wasCorrect,
        hintType,
        tokenSpent: tokenSpent && hintType === "ตรง",
        pointsDelta: delta,
        timedOut,
      };

      return { ...next, roundLog: [...next.roundLog, round] };
    }

    case "RESOLVE_STEAL": {
      const question = state.questions[state.currentQuestionIndex];
      const lastRound = state.roundLog[state.roundLog.length - 1];
      if (!question || !lastRound) return state;

      const stealPlayer: PlayerId = lastRound.answeringPlayer === 1 ? 2 : 1;
      const { stealChoice } = action.payload;
      const stealCorrect = stealChoice === question.correctAnswer;
      const stealPoints = scoreForSteal(question.pointValue, stealCorrect);

      const next = addScore(state, stealPlayer, stealPoints);
      const updatedLog = [...next.roundLog];
      updatedLog[updatedLog.length - 1] = {
        ...lastRound,
        stealPlayer,
        stealChoice,
        stealCorrect,
        stealPoints,
      };
      return { ...next, roundLog: updatedLog };
    }

    case "NEXT_QUESTION": {
      const nextIndex = state.currentQuestionIndex + 1;
      if (nextIndex >= state.questions.length) {
        return { ...state, currentQuestionIndex: nextIndex, phase: "final" };
      }
      return { ...state, currentQuestionIndex: nextIndex };
    }

    case "RESOLVE_FINAL": {
      const q = state.finalQuestion;
      if (!q) return state;

      const { player1Choice, player2Choice, revealToken, hintsUsed } = action.payload;
      const p1Correct = player1Choice === q.correctAnswer;
      const p2Correct = player2Choice === q.correctAnswer;
      const p1Points = scoreForFinal(q.pointValue, p1Correct);
      const p2Points = scoreForFinal(q.pointValue, p2Correct);

      const finalResult: FinalResult = {
        questionId: q.id,
        prompt: q.prompt,
        correctAnswer: q.correctAnswer,
        player1Choice,
        player2Choice,
        player1Correct: p1Correct,
        player2Correct: p2Correct,
        player1Points: p1Points,
        player2Points: p2Points,
        revealToken,
      };

      const extraHints: HintRequest[] = (hintsUsed ?? []).map((h) => ({
        questionId: q.id,
        player: h.player,
        // รอบ Final ผู้เล่นไม่ได้เลือกโหมดเอง (ระบบแจกชุดจริง 1 หลอก 2)
        // ค่า hintType ตรงนี้เป็นเพียงค่าตั้งต้นตามชนิดของ HintRequest
        // — ตอนแสดงผลให้ใช้ fromFinalDuel + label จริง/หลอกจากเซิร์ฟเวอร์แทน
        hintType: "ลวง",
        fromFinalDuel: true,
        aiGeneratedText: h.text,
        wasCorrect: h.player === 1 ? p1Correct : p2Correct,
        revealToken: h.revealToken,
        hintId: h.hintId,
      }));

      return {
        ...state,
        player1Score: state.player1Score + p1Points,
        player2Score: state.player2Score + p2Points,
        finalResult,
        hintHistory: [...state.hintHistory, ...extraHints],
      };
    }

    case "GO_DEBRIEF":
      return { ...state, phase: "debrief" };

    case "RESET":
      return { ...initialState };

    default:
      return state;
  }
}

interface GameContextValue {
  state: SessionState;
  dispatch: Dispatch<GameAction>;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame ต้องถูกเรียกภายใน <GameProvider>");
  return ctx;
}

export function nameOf(state: SessionState, player: PlayerId): string {
  return player === 1 ? state.player1Name : state.player2Name;
}

export function scoreOf(state: SessionState, player: PlayerId): number {
  return player === 1 ? state.player1Score : state.player2Score;
}

export function tokenOf(state: SessionState, player: PlayerId): number {
  return player === 1 ? state.player1Tokens : state.player2Tokens;
}
