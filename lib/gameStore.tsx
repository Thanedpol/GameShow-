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
import { MAX_TOKENS, scoreForRound, scoreForSteal, stageKey } from "./scoring";
import type {
  GameState,
  HintUsage,
  MatchMode,
  Participant,
  RoundResult,
} from "./types";

const initialState: GameState = {
  mode: "solo",
  participants: [],
  questions: [],
  currentQuestionIndex: 0,
  phase: "setup",
  roundLog: [],
  hintHistory: [],
  stageOpened: {},
};

export interface ResolveRoundPayload {
  participantId: string;
  answer: string | null;
  /** 0-100 — ปรนัยส่ง 0/100 · อัตนัยส่งคะแนนจาก Claude · โชว์ส่งคะแนนจากดาว */
  quality: number;
  boxesOpened: number;
  tokenSpent: boolean;
  timedOut: boolean;
  feedback?: string;
  /** กล่องที่เปิดจริง เพื่อบันทึกไว้ใช้ตอนสรุปผล */
  openedBoxes?: Array<{ boxId: string; boxLabel: string; text: string; revealToken: string }>;
}

export type GameAction =
  | { type: "START_GAME"; mode: MatchMode; participants: Participant[] }
  | { type: "RESOLVE_ROUND"; payload: ResolveRoundPayload }
  | { type: "RESOLVE_STEAL"; participantId: string; correct: boolean }
  | { type: "NEXT_QUESTION" }
  | { type: "RESET" };

function addScore(
  participants: Participant[],
  id: string,
  delta: number,
): Participant[] {
  return participants.map((p) => (p.id === id ? { ...p, score: p.score + delta } : p));
}

function adjustToken(
  participants: Participant[],
  id: string,
  delta: number,
): Participant[] {
  return participants.map((p) =>
    p.id === id
      ? { ...p, tokens: Math.max(0, Math.min(MAX_TOKENS, p.tokens + delta)) }
      : p,
  );
}

function reducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "START_GAME": {
      const { main, final } = drawQuestions();
      return {
        ...initialState,
        mode: action.mode,
        participants: action.participants,
        questions: [...main, final],
        phase: "playing",
      };
    }

    case "RESOLVE_ROUND": {
      const question = state.questions[state.currentQuestionIndex];
      if (!question) return state;

      const {
        participantId,
        answer,
        quality,
        boxesOpened,
        tokenSpent,
        timedOut,
        feedback,
        openedBoxes,
      } = action.payload;

      const paidBoxes = Math.max(0, boxesOpened - (tokenSpent ? 1 : 0));
      const points = scoreForRound({
        pointValue: question.pointValue,
        quality,
        paidBoxes,
        timedOut,
      });

      let participants = addScore(state.participants, participantId, points);
      if (tokenSpent) participants = adjustToken(participants, participantId, -1);

      // โทเคน: ตอบถูกในข้อแรกของช่วงนั้น โดยไม่เปิดกล่องเลย → +1
      const key = stageKey(participantId, question.stage);
      let stageOpened = state.stageOpened;
      if (!stageOpened[key]) {
        stageOpened = { ...stageOpened, [key]: true };
        if (!timedOut && quality >= 100 && boxesOpened === 0) {
          participants = adjustToken(participants, participantId, +1);
        }
      }

      const correct = !timedOut && quality >= 60;

      const hintRecords: HintUsage[] = (openedBoxes ?? []).map((box) => ({
        questionId: question.id,
        participantId,
        boxLabel: box.boxLabel,
        boxId: box.boxId,
        text: box.text,
        revealToken: box.revealToken,
        wasCorrect: correct,
      }));

      const round: RoundResult = {
        questionId: question.id,
        stage: question.stage,
        format: question.format,
        prompt: question.prompt,
        participantId,
        answer,
        correct,
        quality,
        boxesOpened,
        tokenSpent,
        points,
        timedOut,
        feedback,
      };

      return {
        ...state,
        participants,
        stageOpened,
        roundLog: [...state.roundLog, round],
        hintHistory: [...state.hintHistory, ...hintRecords],
      };
    }

    case "RESOLVE_STEAL": {
      const question = state.questions[state.currentQuestionIndex];
      const last = state.roundLog[state.roundLog.length - 1];
      if (!question || !last) return state;

      const points = scoreForSteal(question.pointValue, action.correct);
      const participants = addScore(state.participants, action.participantId, points);
      const roundLog = [...state.roundLog];
      roundLog[roundLog.length - 1] = {
        ...last,
        stealParticipantId: action.participantId,
        stealPoints: points,
      };
      return { ...state, participants, roundLog };
    }

    case "NEXT_QUESTION": {
      const next = state.currentQuestionIndex + 1;
      if (next >= state.questions.length) {
        return { ...state, currentQuestionIndex: state.questions.length - 1, phase: "debrief" };
      }
      return { ...state, currentQuestionIndex: next };
    }

    case "RESET":
      return { ...initialState };

    default:
      return state;
  }
}

interface GameContextValue {
  state: GameState;
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
