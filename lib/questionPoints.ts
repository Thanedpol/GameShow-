import type { Stage } from "./types";

/**
 * คะแนนตั้งต้นของแต่ละช่วง
 *
 * แยกออกมาเป็นไฟล์ของตัวเองเพราะทั้ง questions.ts และ questionsExtra.ts ต้องใช้
 * ถ้าปล่อยไว้ในไฟล์ใดไฟล์หนึ่งจะกลายเป็น circular import ทันทีที่อีกฝั่งอ้างถึง
 *
 * ค่าจริงที่ใช้ตอนเล่นมาจากหลังบ้าน (`GameSettings.points`) ตัวนี้เป็นแค่ค่าตั้งต้น
 * ที่ติดมากับตัวข้อ และจะถูก `drawQuestions()` เขียนทับให้ตรงกับกติกาที่ตั้งไว้
 */
export const POINTS: Record<Stage, number> = {
  warmup: 100,
  push: 200,
  final: 300,
};
