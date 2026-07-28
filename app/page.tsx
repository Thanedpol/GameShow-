"use client";

import { useEffect } from "react";
import DebriefScreen from "@/components/DebriefScreen";
import FollowerScreen from "@/components/FollowerScreen";
import QuestionScreen from "@/components/QuestionScreen";
import SetupScreen from "@/components/SetupScreen";
import { useGame } from "@/lib/gameStore";
import { useRoom } from "@/lib/roomClient";

export default function Page() {
  const { state } = useGame();
  const { session, isHost, syncSnapshot } = useRoom();

  // เจ้าภาพส่งสถานะขึ้นห้องทุกครั้งที่มีอะไรเปลี่ยน — จุดเดียวจบ
  // ไม่ต้องไปแทรก syncSnapshot ตามหน้าจอต่าง ๆ ให้กระจัดกระจาย
  useEffect(() => {
    if (isHost) syncSnapshot(state);
  }, [isHost, state, syncSnapshot]);

  // ผู้ติดตามวาดจอจากสแนปช็อตของเจ้าภาพ ไม่ใช้ state ในเครื่องตัวเอง
  if (session && !isHost) return <FollowerScreen />;

  switch (state.phase) {
    case "playing":
      return <QuestionScreen />;
    case "debrief":
      return <DebriefScreen />;
    default:
      return <SetupScreen />;
  }
}
