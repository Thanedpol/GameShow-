"use client";

import DebriefScreen from "@/components/DebriefScreen";
import QuestionScreen from "@/components/QuestionScreen";
import SetupScreen from "@/components/SetupScreen";
import { useGame } from "@/lib/gameStore";

export default function Page() {
  const { state } = useGame();

  switch (state.phase) {
    case "playing":
      return <QuestionScreen />;
    case "debrief":
      return <DebriefScreen />;
    default:
      return <SetupScreen />;
  }
}
