/**
 * header ที่ต้องแนบไปกับทุกคำขอที่ทำให้เซิร์ฟเวอร์ไปเรียกโมเดล
 *
 * กุญแจร่วมนี้ทำหน้าที่เดียว: แยก "คำขอที่มาจากหน้าเว็บของเกม" ออกจาก
 * "คำขอที่ยิงตรงเข้ามา" เพื่อตัดบอทสแกนกับสคริปต์ยิงมั่วให้จบตั้งแต่ด่านแรก
 *
 * ⚠️ ไม่ใช่ความลับ และไม่ได้ตั้งใจให้เป็น — ค่าที่ขึ้นต้นด้วย NEXT_PUBLIC_
 * ถูกฝังลงในไฟล์ JavaScript ที่ทุกคนที่เปิดเว็บโหลดไปอยู่แล้ว ใครเปิด DevTools
 * ก็อ่านได้ · ตัวที่กันความเสียหายได้จริงคือเพดานจำนวนครั้งต่อ IP ใน
 * lib/apiGuard.ts ซึ่งทำงานอยู่เสมอไม่ว่ากุญแจจะหลุดหรือไม่
 *
 * ไม่ได้ตั้ง env ตัวนี้ไว้ก็ใช้งานได้ปกติ แค่ไม่มีด่านชั้นนี้
 */
export function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = process.env.NEXT_PUBLIC_APP_ACCESS_TOKEN;
  if (key) headers["x-app-key"] = key;
  return headers;
}
