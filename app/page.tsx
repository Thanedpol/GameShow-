"use client";

import DebriefScreen from "@/components/DebriefScreen";
import FinalDuelScreen from "@/components/FinalDuelScreen";
import QuestionScreen from "@/components/QuestionScreen";
import SetupScreen from "@/components/SetupScreen";
import { useGame } from "@/lib/gameStore";

export default function Page() {
  const { state } = useGame();

  switch (state.phase) {
    case "setup":
      return <SetupScreen />;
    case "playing":
      return <QuestionScreen />;
    case "final":
      return <FinalDuelScreen />;
    case "debrief":
      return <DebriefScreen />;
    default:
      return <SetupScreen />;
  }
}
